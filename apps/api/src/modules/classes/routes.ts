import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError, isUniqueViolation, notFound } from '../../lib/http-error.js';
import { addDays, colomboToday, TIME_ZONE } from '../../lib/time.js';
import { ensureSessions } from './schedule.js';

const uuid = z.uuid();
const date = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const MODES = ['physical', 'online', 'hybrid'] as const;
const FK_VIOLATION = '23503';

const batchInput = z.object({
  name: z.string().trim().min(1).max(200),
  subjectId: uuid.optional(),
  /** Creates the subject if it does not exist yet (case-insensitive match). */
  subjectName: z.string().trim().min(1).max(100).optional(),
  teacherMembershipId: uuid.nullish(),
  mode: z.enum(MODES).default('physical'),
  liveUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullish(),
});

const param = (req: FastifyRequest, name: string) => {
  const value = (req.params as Record<string, string>)[name];
  if (!uuid.safeParse(value).success) throw notFound();
  return value!;
};

/** Owner/admin/receptionist see every class; a teacher sees only classes they teach. */
const isManager = (req: FastifyRequest) =>
  req.tenant!.roles.some((r) => r === 'owner' || r === 'admin' || r === 'receptionist');

function visibleBatches(
  req: FastifyRequest,
  q: Knex.QueryBuilder,
  column = 'b.teacher_membership_id',
) {
  if (!isManager(req)) q.where(column, req.tenant!.membershipId);
}

async function findOrCreateSubject(trx: Knex.Transaction, tenantId: string, name: string) {
  const existing = await trx('subjects').whereRaw('lower(name) = lower(?)', [name]).first('id');
  if (existing) return existing.id as string;
  const [row] = await trx('subjects').insert({ tenant_id: tenantId, name }).returning('id');
  return row.id as string;
}

async function getBatch(trx: Knex.Transaction, req: FastifyRequest, id: string) {
  const batch = await trx('batches as b')
    .join('subjects as s', 's.id', 'b.subject_id')
    .leftJoin('tenant_memberships as m', 'm.id', 'b.teacher_membership_id')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .where('b.id', id)
    .modify((q) => visibleBatches(req, q))
    .first(
      'b.id',
      'b.name',
      'b.mode',
      'b.status',
      'b.live_url as liveUrl',
      's.id as subjectId',
      's.name as subjectName',
      'b.teacher_membership_id as teacherMembershipId',
      'u.full_name as teacherName',
    );
  if (!batch) return undefined;
  const today = colomboToday();
  const schedule = await trx('schedule_rules')
    .where({ batch_id: id })
    .where((q) => q.whereNull('valid_to').orWhere('valid_to', '>=', today))
    .orderBy(['weekday', 'start_time'])
    .select(
      'id',
      'weekday',
      trx.raw(`to_char(start_time, 'HH24:MI') as "startTime"`),
      trx.raw(`to_char(end_time, 'HH24:MI') as "endTime"`),
      trx.raw(`to_char(valid_from, 'YYYY-MM-DD') as "validFrom"`),
      'room',
    );
  const students = await trx('enrollments as e')
    .join('students as st', 'st.id', 'e.student_id')
    .where({ 'e.batch_id': id, 'e.status': 'active' })
    .orderByRaw('lower(st.full_name)')
    .select(
      'st.id',
      'st.student_number as studentNumber',
      'st.full_name as fullName',
      trx.raw(`to_char(e.enrolled_on, 'YYYY-MM-DD') as "enrolledOn"`),
    );
  return { ...batch, schedule, students };
}

export default async function classRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const managers = app.requireRole('owner', 'admin');
  const desk = app.requireRole('owner', 'admin', 'receptionist');
  const viewers = app.requireRole('owner', 'admin', 'receptionist', 'teacher');

  // ---- Subjects ----------------------------------------------------------------
  app.get('/subjects', { preHandler: viewers }, async (req) => ({
    subjects: await req.withTenant((trx) => trx('subjects').orderBy('name').select('id', 'name')),
  }));

  app.post('/subjects', { preHandler: managers }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    try {
      const [subject] = await req.withTenant((trx) =>
        trx('subjects').insert({ tenant_id: req.tenant!.id, name }).returning(['id', 'name']),
      );
      return reply.status(201).send({ subject });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'subject_exists', 'Subject exists');
      throw err;
    }
  });

  // ---- Classes (batches) -----------------------------------------------------------
  app.get('/batches', { preHandler: viewers }, async (req) => {
    const { status } = z
      .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
      .parse(req.query);
    const today = colomboToday();
    const batches = await req.withTenant((trx) =>
      trx('batches as b')
        .join('subjects as s', 's.id', 'b.subject_id')
        .leftJoin('tenant_memberships as m', 'm.id', 'b.teacher_membership_id')
        .leftJoin('users as u', 'u.id', 'm.user_id')
        .modify((q) => {
          visibleBatches(req, q);
          if (status !== 'all') q.where('b.status', status);
        })
        .orderBy([{ column: 's.name' }, { column: 'b.name' }])
        .select(
          'b.id',
          'b.name',
          'b.mode',
          'b.status',
          's.name as subjectName',
          'u.full_name as teacherName',
          trx.raw(
            `(SELECT count(*)::int FROM enrollments e WHERE e.batch_id = b.id AND e.status = 'active') AS "studentCount"`,
          ),
          trx.raw(
            `COALESCE((SELECT json_agg(json_build_object('weekday', r.weekday,
                 'startTime', to_char(r.start_time, 'HH24:MI'), 'endTime', to_char(r.end_time, 'HH24:MI'))
               ORDER BY r.weekday, r.start_time)
               FROM schedule_rules r WHERE r.batch_id = b.id AND (r.valid_to IS NULL OR r.valid_to >= ?)),
             '[]') AS schedule`,
            [today],
          ),
        ),
    );
    return { batches };
  });

  app.post('/batches', { preHandler: managers }, async (req, reply) => {
    const body = batchInput.parse(req.body);
    if (!body.subjectId && !body.subjectName) {
      throw new HttpError(400, 'subject_required', 'Choose or enter a subject');
    }
    const tenantId = req.tenant!.id;
    try {
      const batch = await req.withTenant(async (trx) => {
        const subjectId =
          body.subjectId ?? (await findOrCreateSubject(trx, tenantId, body.subjectName!));
        const [row] = await trx('batches')
          .insert({
            tenant_id: tenantId,
            subject_id: subjectId,
            name: body.name,
            teacher_membership_id: body.teacherMembershipId ?? null,
            mode: body.mode,
            live_url: body.liveUrl ?? null,
          })
          .returning('id');
        return getBatch(trx, req, row.id);
      });
      return reply.status(201).send({ batch });
    } catch (err) {
      // Composite FKs reject a subject/teacher from another tenant (or one that does not exist).
      if ((err as { code?: string }).code === FK_VIOLATION) {
        throw new HttpError(400, 'invalid_reference', 'Unknown subject or teacher');
      }
      throw err;
    }
  });

  app.get('/batches/:batchId', { preHandler: viewers }, async (req) => {
    const id = param(req, 'batchId');
    const batch = await req.withTenant((trx) => getBatch(trx, req, id));
    if (!batch) throw notFound();
    return { batch };
  });

  app.patch('/batches/:batchId', { preHandler: managers }, async (req) => {
    const id = param(req, 'batchId');
    const body = batchInput
      .omit({ subjectName: true })
      .partial()
      // No default on update: otherwise every edit would reset the mode to 'physical'.
      .extend({ mode: z.enum(MODES).optional(), status: z.enum(['active', 'archived']).optional() })
      .parse(req.body);
    try {
      const batch = await req.withTenant(async (trx) => {
        const fields = {
          name: body.name,
          subject_id: body.subjectId,
          teacher_membership_id: body.teacherMembershipId,
          mode: body.mode,
          live_url: body.liveUrl,
          status: body.status,
        };
        const changes = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined),
        );
        const n = await trx('batches')
          .where({ id })
          .update({ ...changes, updated_at: trx.fn.now() });
        return n ? getBatch(trx, req, id) : undefined;
      });
      if (!batch) throw notFound();
      return { batch };
    } catch (err) {
      if ((err as { code?: string }).code === FK_VIOLATION) {
        throw new HttpError(400, 'invalid_reference', 'Unknown subject or teacher');
      }
      throw err;
    }
  });

  // ---- Weekly schedule ---------------------------------------------------------------
  app.post('/batches/:batchId/schedule', { preHandler: managers }, async (req, reply) => {
    const id = param(req, 'batchId');
    const body = z
      .object({
        weekday: z.number().int().min(1).max(7),
        startTime: hhmm,
        endTime: hhmm,
        validFrom: date.optional(),
        room: z.string().trim().max(100).optional(),
      })
      .refine((b) => b.endTime > b.startTime, { path: ['endTime'], message: 'end_before_start' })
      .parse(req.body);
    const validFrom = body.validFrom ?? colomboToday();
    const batch = await req.withTenant(async (trx) => {
      const exists = await trx('batches').where({ id }).first('id');
      if (!exists) return undefined;
      await trx('schedule_rules').insert({
        tenant_id: req.tenant!.id,
        batch_id: id,
        weekday: body.weekday,
        start_time: body.startTime,
        end_time: body.endTime,
        valid_from: validFrom,
        room: body.room || null,
      });
      // Show the next 8 weeks on the timetable straight away.
      await ensureSessions(trx, validFrom, addDays(colomboToday(), 56), id);
      return getBatch(trx, req, id);
    });
    if (!batch) throw notFound();
    return reply.status(201).send({ batch });
  });

  // Ending a weekly slot keeps past sessions (and their attendance) and removes future ones.
  app.delete('/batches/:batchId/schedule/:ruleId', { preHandler: managers }, async (req) => {
    const batchId = param(req, 'batchId');
    const ruleId = param(req, 'ruleId');
    const today = colomboToday();
    const batch = await req.withTenant(async (trx) => {
      const rule = await trx('schedule_rules')
        .where({ id: ruleId, batch_id: batchId })
        .first('id', trx.raw(`to_char(valid_from, 'YYYY-MM-DD') as "validFrom"`));
      if (!rule) return undefined;
      await trx('class_sessions')
        .where({ schedule_rule_id: ruleId, status: 'scheduled' })
        .where('occurrence_date', '>', today)
        .delete();
      const kept = await trx('class_sessions').where({ schedule_rule_id: ruleId }).first('id');
      if (!kept) {
        // Never used: remove the rule completely.
        await trx('class_sessions').where({ schedule_rule_id: ruleId }).delete();
        await trx('schedule_rules').where({ id: ruleId }).delete();
      } else {
        await trx('schedule_rules')
          .where({ id: ruleId })
          .update({
            valid_to: rule.validFrom > today ? rule.validFrom : today,
            updated_at: trx.fn.now(),
          });
      }
      return getBatch(trx, req, batchId);
    });
    if (!batch) throw notFound();
    return { batch };
  });

  // ---- Enrollments -------------------------------------------------------------------
  app.post('/batches/:batchId/enrollments', { preHandler: desk }, async (req) => {
    const batchId = param(req, 'batchId');
    const { studentIds } = z.object({ studentIds: z.array(uuid).min(1).max(200) }).parse(req.body);
    try {
      const result = await req.withTenant(async (trx) => {
        const batch = await trx('batches').where({ id: batchId, status: 'active' }).first('id');
        if (!batch) return undefined;
        const { rowCount } = await trx.raw(
          `INSERT INTO enrollments (tenant_id, batch_id, student_id)
           SELECT ?, ?, unnest(?::uuid[])
           ON CONFLICT (tenant_id, batch_id, student_id) WHERE status = 'active' DO NOTHING`,
          [req.tenant!.id, batchId, studentIds],
        );
        return { added: rowCount as number, batch: await getBatch(trx, req, batchId) };
      });
      if (!result) throw notFound();
      return result;
    } catch (err) {
      if ((err as { code?: string }).code === FK_VIOLATION) {
        throw new HttpError(400, 'invalid_reference', 'Unknown student');
      }
      throw err;
    }
  });

  app.delete('/batches/:batchId/enrollments/:studentId', { preHandler: desk }, async (req) => {
    const batchId = param(req, 'batchId');
    const studentId = param(req, 'studentId');
    const n = await req.withTenant((trx) =>
      trx('enrollments')
        .where({ batch_id: batchId, student_id: studentId, status: 'active' })
        .update({ status: 'left', left_on: colomboToday(), updated_at: trx.fn.now() }),
    );
    if (!n) throw notFound();
    return { removed: n };
  });

  // ---- Sessions / timetable ------------------------------------------------------------
  const sessionColumns = (trx: Knex.Transaction) => [
    'cs.id',
    'cs.batch_id as batchId',
    'b.name as batchName',
    's.name as subjectName',
    'u.full_name as teacherName',
    'cs.starts_at as startsAt',
    'cs.ends_at as endsAt',
    'cs.status',
    'cs.note',
    trx.raw('(cs.schedule_rule_id IS NULL) AS "isExtra"'),
    'r.room',
  ];
  const sessionQuery = (trx: Knex.Transaction, req: FastifyRequest) =>
    trx('class_sessions as cs')
      .join('batches as b', 'b.id', 'cs.batch_id')
      .join('subjects as s', 's.id', 'b.subject_id')
      .leftJoin('schedule_rules as r', 'r.id', 'cs.schedule_rule_id')
      .leftJoin('tenant_memberships as m', 'm.id', 'b.teacher_membership_id')
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .modify((q) => visibleBatches(req, q))
      .select(sessionColumns(trx));

  app.get('/sessions', { preHandler: viewers }, async (req) => {
    const today = colomboToday();
    const query = z
      .object({ from: date.default(today), to: date.optional(), batchId: uuid.optional() })
      .parse(req.query);
    const to = query.to ?? addDays(query.from, 6);
    if (to < query.from || to > addDays(query.from, 62)) {
      throw new HttpError(400, 'invalid_range', 'Choose at most 62 days');
    }
    const sessions = await req.withTenant(async (trx) => {
      await ensureSessions(trx, query.from, to, query.batchId);
      return sessionQuery(trx, req)
        .whereRaw(`(cs.starts_at AT TIME ZONE '${TIME_ZONE}')::date BETWEEN ? AND ?`, [
          query.from,
          to,
        ])
        .modify((q) => {
          if (query.batchId) q.where('cs.batch_id', query.batchId);
        })
        .orderBy('cs.starts_at');
    });
    return { from: query.from, to, sessions };
  });

  // Extra one-off class (e.g. a revision day).
  app.post('/batches/:batchId/sessions', { preHandler: viewers }, async (req, reply) => {
    const batchId = param(req, 'batchId');
    const body = z
      .object({
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
        note: z.string().trim().max(300).optional(),
      })
      .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
        path: ['endsAt'],
        message: 'end_before_start',
      })
      .parse(req.body);
    const session = await req.withTenant(async (trx) => {
      const batch = await trx('batches as b')
        .where('b.id', batchId)
        .modify((q) => visibleBatches(req, q))
        .first('b.id');
      if (!batch) return undefined;
      const [row] = await trx('class_sessions')
        .insert({
          tenant_id: req.tenant!.id,
          batch_id: batchId,
          starts_at: body.startsAt,
          ends_at: body.endsAt,
          note: body.note || null,
        })
        .returning('id');
      return sessionQuery(trx, req).where('cs.id', row.id).first();
    });
    if (!session) throw notFound();
    return reply.status(201).send({ session });
  });

  // Cancel, restore or move one session without touching the weekly rule.
  app.patch('/sessions/:sessionId', { preHandler: viewers }, async (req) => {
    const id = param(req, 'sessionId');
    const body = z
      .object({
        status: z.enum(['scheduled', 'cancelled']).optional(),
        startsAt: z.iso.datetime({ offset: true }).optional(),
        endsAt: z.iso.datetime({ offset: true }).optional(),
        note: z.string().trim().max(300).nullish(),
      })
      .parse(req.body);
    const session = await req.withTenant(async (trx) => {
      const current = await sessionQuery(trx, req).where('cs.id', id).first();
      if (!current) return undefined;
      const startsAt = body.startsAt ?? current.startsAt;
      const endsAt = body.endsAt ?? current.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) {
        throw new HttpError(400, 'end_before_start', 'End must be after start');
      }
      await trx('class_sessions')
        .where({ id })
        .update({
          status: body.status,
          starts_at: body.startsAt,
          ends_at: body.endsAt,
          note: body.note === undefined ? undefined : body.note || null,
          updated_at: trx.fn.now(),
        });
      return sessionQuery(trx, req).where('cs.id', id).first();
    });
    if (!session) throw notFound();
    return { session };
  });
}
