import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { colomboToday } from '../../lib/time.js';
import { ensureSessions } from '../classes/schedule.js';

/** A scan counts for a class from this long before it starts until it ends. */
const OPEN_MINUTES_BEFORE = 60;
/** Arriving later than this after the start is marked late. */
const LATE_AFTER_MINUTES = 15;

const uuid = z.uuid();
const STATUSES = ['present', 'late', 'absent'] as const;
const newToken = () => randomBytes(12).toString('base64url'); // 16 chars, ~96 bits

const param = (req: FastifyRequest, name: string) => {
  const value = (req.params as Record<string, string>)[name];
  if (!uuid.safeParse(value).success) throw notFound();
  return value!;
};
const isDesk = (req: FastifyRequest) =>
  req.tenant!.roles.some((r) => r === 'owner' || r === 'admin' || r === 'receptionist');

/** The session, if this user may see it (teachers: only their own classes). */
function visibleSession(trx: Knex.Transaction, req: FastifyRequest, sessionId: string) {
  return trx('class_sessions as cs')
    .join('batches as b', 'b.id', 'cs.batch_id')
    .join('subjects as s', 's.id', 'b.subject_id')
    .where('cs.id', sessionId)
    .modify((q) => {
      if (!isDesk(req)) q.where('b.teacher_membership_id', req.tenant!.membershipId);
    })
    .first(
      'cs.id',
      'cs.batch_id as batchId',
      'b.name as batchName',
      's.name as subjectName',
      'cs.starts_at as startsAt',
      'cs.ends_at as endsAt',
      'cs.status',
    );
}

const guardiansOf = (trx: Knex.Transaction, studentId: string) =>
  trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('sg.student_id', studentId)
    .orderBy('g.full_name')
    .select('g.full_name as fullName', 'g.phone', 'sg.relationship');

async function ensureCards(trx: Knex.Transaction, tenantId: string, studentIds: string[]) {
  if (studentIds.length === 0) return;
  const { rows } = await trx.raw(
    `SELECT st.id FROM students st
     WHERE st.id = ANY(?::uuid[]) AND NOT EXISTS (
       SELECT 1 FROM student_cards c WHERE c.student_id = st.id AND c.status = 'active')`,
    [studentIds],
  );
  if (rows.length === 0) return;
  await trx.raw(
    `INSERT INTO student_cards (tenant_id, student_id, token)
     SELECT ?, x.student_id, x.token FROM unnest(?::uuid[], ?::text[]) AS x(student_id, token)
     ON CONFLICT (tenant_id, student_id) WHERE status = 'active' DO NOTHING`,
    [tenantId, rows.map((r: { id: string }) => r.id), rows.map(() => newToken())],
  );
}

const cardRows = (trx: Knex.Transaction, studentIds: string[]) =>
  trx('student_cards as c')
    .join('students as st', 'st.id', 'c.student_id')
    .whereIn('c.student_id', studentIds)
    .where('c.status', 'active')
    .orderByRaw('lower(st.full_name)')
    .select(
      'st.id as studentId',
      'st.student_number as studentNumber',
      'st.full_name as fullName',
      'st.grade',
      'c.token',
    );

export default async function attendanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const desk = app.requireRole('owner', 'admin', 'receptionist');
  const viewers = app.requireRole('owner', 'admin', 'receptionist', 'teacher');

  // ---- Cards -------------------------------------------------------------------------
  // Cards for a class (or chosen students), creating any that are missing. Used for printing.
  app.post('/cards', { preHandler: desk }, async (req) => {
    const body = z
      .object({ batchId: uuid.optional(), studentIds: z.array(uuid).max(2000).optional() })
      .refine((b) => b.batchId || b.studentIds?.length, { message: 'batch_or_students' })
      .parse(req.body);
    const cards = await req.withTenant(async (trx) => {
      const ids: string[] = body.batchId
        ? await trx('enrollments as e')
            .join('students as st', 'st.id', 'e.student_id')
            .where({ 'e.batch_id': body.batchId, 'e.status': 'active', 'st.status': 'active' })
            .pluck('st.id')
        : await trx('students')
            .whereIn('id', body.studentIds!)
            .where({ status: 'active' })
            .pluck('id');
      await ensureCards(trx, req.tenant!.id, ids);
      return cardRows(trx, ids);
    });
    return { cards };
  });

  // Lost card: the old QR stops working immediately.
  app.post('/students/:studentId/card/replace', { preHandler: desk }, async (req) => {
    const studentId = param(req, 'studentId');
    const cards = await req.withTenant(async (trx) => {
      const student = await trx('students').where({ id: studentId }).first('id');
      if (!student) return undefined;
      await trx('student_cards')
        .where({ student_id: studentId, status: 'active' })
        .update({ status: 'revoked', revoked_at: trx.fn.now() });
      await ensureCards(trx, req.tenant!.id, [studentId]);
      return cardRows(trx, [studentId]);
    });
    if (!cards) throw notFound();
    return { card: cards[0] };
  });

  // ---- Scan --------------------------------------------------------------------------
  app.post('/attendance/scan', { preHandler: desk }, async (req) => {
    const body = z
      .object({
        /** QR token from the card, or a typed student number. */
        code: z.string().trim().min(1).max(64),
        sessionId: uuid.optional(),
      })
      .parse(req.body);
    const tenantId = req.tenant!.id;
    const membershipId = req.tenant!.membershipId;

    return req.withTenant(async (trx) => {
      const student = /^\d{1,20}$/.test(body.code)
        ? await trx('students')
            .where({ student_number: body.code })
            .first('id', 'student_number', 'full_name', 'status')
        : await trx('student_cards as c')
            .join('students as st', 'st.id', 'c.student_id')
            .where({ 'c.token': body.code, 'c.status': 'active' })
            .first('st.id', 'st.student_number', 'st.full_name', 'st.status');
      if (!student) throw new HttpError(404, 'card_not_found', 'Card or student not found');
      const who = {
        id: student.id,
        studentNumber: student.student_number,
        fullName: student.full_name,
      };
      if (student.status !== 'active') {
        throw new HttpError(400, 'student_inactive', 'Student is inactive', { student: who });
      }

      const today = colomboToday();
      await ensureSessions(trx, today, today);
      const { rows } = await trx.raw(
        `SELECT cs.id, b.name AS "batchName", s.name AS "subjectName",
                cs.starts_at AS "startsAt", cs.ends_at AS "endsAt",
                (now() > cs.starts_at + make_interval(mins => ?)) AS late
         FROM class_sessions cs
         JOIN batches b ON b.id = cs.batch_id
         JOIN subjects s ON s.id = b.subject_id
         JOIN enrollments e ON e.batch_id = cs.batch_id AND e.student_id = ? AND e.status = 'active'
         WHERE cs.status = 'scheduled'
           AND now() BETWEEN cs.starts_at - make_interval(mins => ?) AND cs.ends_at
           ${body.sessionId ? 'AND cs.id = ?' : ''}
         ORDER BY abs(extract(epoch FROM cs.starts_at - now()))
         LIMIT 1`,
        body.sessionId
          ? [LATE_AFTER_MINUTES, student.id, OPEN_MINUTES_BEFORE, body.sessionId]
          : [LATE_AFTER_MINUTES, student.id, OPEN_MINUTES_BEFORE],
      );
      const session = rows[0];
      if (!session) {
        throw new HttpError(404, 'no_class_now', 'No class for this student right now', {
          student: who,
        });
      }
      const { late, ...sessionInfo } = session;

      const inserted = await trx('attendance_records')
        .insert({
          tenant_id: tenantId,
          session_id: session.id,
          student_id: student.id,
          status: late ? 'late' : 'present',
          method: 'scan',
          marked_by_membership_id: membershipId,
        })
        .onConflict(['tenant_id', 'session_id', 'student_id'])
        .ignore()
        .returning(['status', 'marked_at as markedAt']);
      const attendance =
        inserted[0] ??
        (await trx('attendance_records')
          .where({ session_id: session.id, student_id: student.id })
          .first('status', 'marked_at as markedAt'));
      return {
        student: who,
        session: sessionInfo,
        attendance,
        duplicate: inserted.length === 0,
        guardians: await guardiansOf(trx, student.id),
      };
    });
  });

  // ---- Per-class register ----------------------------------------------------------------
  app.get('/sessions/:sessionId/attendance', { preHandler: viewers }, async (req) => {
    const sessionId = param(req, 'sessionId');
    const result = await req.withTenant(async (trx) => {
      const session = await visibleSession(trx, req, sessionId);
      if (!session) return undefined;
      // Students in the class now, plus anyone already marked (e.g. left the class later).
      const { rows } = await trx.raw(
        `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS "fullName",
                a.status, a.method, a.marked_at AS "markedAt"
         FROM students st
         LEFT JOIN attendance_records a ON a.student_id = st.id AND a.session_id = ?
         WHERE a.id IS NOT NULL OR EXISTS (
           SELECT 1 FROM enrollments e WHERE e.student_id = st.id AND e.batch_id = ? AND e.status = 'active')
         ORDER BY lower(st.full_name)`,
        [sessionId, session.batchId],
      );
      return { session, students: rows };
    });
    if (!result) throw notFound();
    return result;
  });

  app.put('/sessions/:sessionId/attendance/:studentId', { preHandler: viewers }, async (req) => {
    const sessionId = param(req, 'sessionId');
    const studentId = param(req, 'studentId');
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
    const tenantId = req.tenant!.id;
    const membershipId = req.tenant!.membershipId;
    const record = await req.withTenant(async (trx) => {
      const session = await visibleSession(trx, req, sessionId);
      if (!session) return undefined;
      const enrolled = await trx('enrollments')
        .where({ batch_id: session.batchId, student_id: studentId })
        .first('id');
      if (!enrolled) throw new HttpError(400, 'not_enrolled', 'Student is not in this class');

      const existing = await trx('attendance_records')
        .where({ session_id: sessionId, student_id: studentId })
        .forUpdate()
        .first('id', 'status');
      if (!existing) {
        await trx('attendance_records').insert({
          tenant_id: tenantId,
          session_id: sessionId,
          student_id: studentId,
          status,
          method: 'manual',
          marked_by_membership_id: membershipId,
        });
      } else if (existing.status !== status) {
        await trx('attendance_records')
          .where({ id: existing.id })
          .update({ status, updated_at: trx.fn.now() });
        await trx('attendance_changes').insert({
          tenant_id: tenantId,
          attendance_id: existing.id,
          old_status: existing.status,
          new_status: status,
          changed_by_membership_id: membershipId,
        });
      }
      return trx('attendance_records')
        .where({ session_id: sessionId, student_id: studentId })
        .first('status', 'method', 'marked_at as markedAt');
    });
    if (!record) throw notFound();
    return { attendance: record };
  });
}
