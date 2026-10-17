import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { assertCanAddHead } from '../billing/index.js';
import { importStudents } from './import.js';
import { createStudent, findDuplicate, getStudent, setGuardians, studentInput } from './service.js';

const UUID = z.uuid();
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url');
function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (Array.isArray(value) && typeof value[0] === 'string' && UUID.safeParse(value[1]).success) {
      return value as [string, string];
    }
  } catch {
    // Fall through: malformed cursor.
  }
  throw new HttpError(400, 'invalid_cursor', 'Invalid cursor');
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Desk staff see every student; a teacher only students enrolled in a class they teach. */
function visibleStudents(req: FastifyRequest, q: Knex.QueryBuilder, column = 's.id') {
  if (req.tenant!.roles.some((r) => r === 'owner' || r === 'admin' || r === 'receptionist')) return;
  q.whereExists((sub) =>
    sub
      .select(sub.client.raw('1'))
      .from('enrollments as te')
      .join('batches as tb', 'tb.id', 'te.batch_id')
      .whereRaw(`te.student_id = ${column}`)
      .where({ 'te.status': 'active', 'tb.teacher_membership_id': req.tenant!.membershipId }),
  );
}

export default async function studentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const staff = app.requireRole('owner', 'admin', 'receptionist');
  const viewers = app.requireRole('owner', 'admin', 'receptionist', 'teacher');

  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string', bodyLimit: 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  app.get('/', { preHandler: viewers }, async (req) => {
    const query = listQuery.parse(req.query);
    type Row = { id: string; sort_name: string; [key: string]: unknown };
    const rows: Row[] = await req.withTenant((trx) =>
      trx('students as s')
        .select(
          's.id',
          's.student_number as studentNumber',
          's.full_name as fullName',
          's.phone',
          's.grade',
          's.status',
          trx.raw('lower(s.full_name) as sort_name'),
          trx.raw(`(SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                    WHERE sg.student_id = s.id ORDER BY g.full_name LIMIT 1) AS "guardianPhone"`),
        )
        .modify((q) => {
          visibleStudents(req, q);
          if (query.status !== 'all') q.where('s.status', query.status);
          if (query.q) {
            const term = query.q;
            const digits = term.replace(/\D/g, '').replace(/^0/, '');
            q.where((w) => {
              w.whereILike('s.full_name', `%${escapeLike(term)}%`).orWhere(
                's.student_number',
                term,
              );
              if (digits.length >= 4) {
                w.orWhereLike('s.phone', `%${digits}%`).orWhereExists((sub) =>
                  sub
                    .select(trx.raw('1'))
                    .from('student_guardians as sg')
                    .join('guardians as g', 'g.id', 'sg.guardian_id')
                    .whereRaw('sg.student_id = s.id')
                    .whereLike('g.phone', `%${digits}%`),
                );
              }
            });
          }
          if (query.cursor) {
            const [name, id] = decodeCursor(query.cursor);
            q.whereRaw('(lower(s.full_name), s.id) > (?, ?)', [name, id]);
          }
        })
        .orderByRaw('lower(s.full_name), s.id')
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop the internal sort key
      students: page.map(({ sort_name, ...s }) => s),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.sort_name, last.id) : null,
    };
  });

  app.post('/', { preHandler: staff }, async (req, reply) => {
    const body = studentInput
      .extend({ allowDuplicate: z.boolean().default(false) })
      .parse(req.body);
    const tenantId = req.tenant!.id;
    const created = await req.withTenant(async (trx) => {
      if (!body.allowDuplicate) {
        const existing = await findDuplicate(trx, body);
        if (existing) {
          throw new HttpError(
            409,
            'possible_duplicate',
            'A student with this name and phone already exists',
            { existing },
          );
        }
      }
      await assertCanAddHead(trx, tenantId, 'student');
      const { id } = await createStudent(trx, tenantId, body);
      return getStudent(trx, id);
    });
    return reply.status(201).send({ student: created });
  });

  app.post(
    '/import',
    { preHandler: staff, config: { feature: 'student_import' } },
    async (req, reply) => {
      if (typeof req.body !== 'string') {
        throw new HttpError(415, 'unsupported_media_type', 'Send the file as text/csv');
      }
      const { dryRun } = z
        .object({ dryRun: z.enum(['true', 'false']).default('true') })
        .parse(req.query);
      const csv = req.body;
      const result = await req.withTenant((trx) =>
        importStudents(trx, req.tenant!.id, csv, dryRun === 'true'),
      );
      return reply.status(result.errors.length ? 400 : 200).send({ result });
    },
  );

  app.get('/:studentId', { preHandler: viewers }, async (req) => {
    const { studentId } = req.params as { studentId: string };
    if (!UUID.safeParse(studentId).success) throw notFound();
    const student = await req.withTenant(async (trx) => {
      const visible = await trx('students as s')
        .where('s.id', studentId)
        .modify((q) => visibleStudents(req, q))
        .first('s.id');
      return visible ? getStudent(trx, studentId) : undefined;
    });
    if (!student) throw notFound();
    return { student };
  });

  app.patch('/:studentId', { preHandler: staff }, async (req) => {
    const { studentId } = req.params as { studentId: string };
    if (!UUID.safeParse(studentId).success) throw notFound();
    const body = studentInput
      .partial()
      .extend({ status: z.enum(['active', 'inactive']).optional() })
      .parse(req.body);
    const tenantId = req.tenant!.id;
    const student = await req.withTenant(async (trx) => {
      const fields = {
        full_name: body.fullName,
        phone: body.phone,
        email: body.email,
        school: body.school,
        grade: body.grade,
        notes: body.notes,
        status: body.status,
      };
      const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (body.status === 'active') {
        const current = await trx('students').where({ id: studentId }).first('status');
        if (current?.status === 'inactive') await assertCanAddHead(trx, tenantId, 'student');
      }
      const updated = await trx('students')
        .where({ id: studentId })
        .update({ ...changes, updated_at: trx.fn.now() });
      if (!updated) return undefined;
      if (body.guardians) await setGuardians(trx, tenantId, studentId, body.guardians);
      return getStudent(trx, studentId);
    });
    if (!student) throw notFound();
    return { student };
  });
}
