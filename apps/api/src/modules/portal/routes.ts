import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { fromCents, toCents } from '../../lib/money.js';
import { normalizePhone } from '../../lib/phone.js';
import { addDays, colomboToday, TIME_ZONE } from '../../lib/time.js';
import { ensureSessions } from '../classes/schedule.js';

const INVITE_DAYS = 14;
const LINK_EARLY_MINUTES = 30;
const uuid = z.uuid();

/** Prefix /api/v1/tenants/:tenantId */
export default async function portalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const desk = app.requireRole('owner', 'admin', 'receptionist');
  const family = app.requireRole('student', 'parent');

  // Portal invite for a student (their own mobile) or a guardian (parent). The phone must be
  // the student's or one of their guardians', so a link can only go to a known number.
  app.post(
    '/students/:studentId/portal-invite',
    { preHandler: desk, config: { feature: 'portal' } },
    async (req, reply) => {
      const { studentId } = req.params as { studentId: string };
      if (!uuid.safeParse(studentId).success) throw notFound();
      const phone = normalizePhone(z.object({ phone: z.string().max(20) }).parse(req.body).phone);
      const token = randomBytes(32).toString('base64url');
      const tenantId = req.tenant!.id;
      const invite = await req.withTenant(async (trx) => {
        const student = await trx('students')
          .where({ id: studentId, status: 'active' })
          .first('full_name', 'phone');
        if (!student) throw notFound();
        const guardian = await trx('student_guardians as sg')
          .join('guardians as g', 'g.id', 'sg.guardian_id')
          .where({ 'sg.student_id': studentId, 'g.phone': phone })
          .first('g.full_name');
        const target =
          student.phone === phone
            ? { role: 'student', fullName: student.full_name }
            : guardian && { role: 'parent', fullName: guardian.full_name };
        if (!target) {
          throw new HttpError(400, 'unknown_phone', 'Use the student’s or a guardian’s mobile');
        }
        await trx('tenant_invites')
          .where({ phone, student_id: studentId, status: 'pending' })
          .update({ status: 'revoked', updated_at: trx.fn.now() });
        await trx('tenant_invites').insert({
          tenant_id: tenantId,
          full_name: target.fullName,
          phone,
          role: target.role,
          student_id: studentId,
          token_hash: createHash('sha256').update(token).digest('hex'),
          expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
          invited_by_membership_id: req.tenant!.membershipId,
        });
        return { ...target, phone, studentName: student.full_name };
      });
      return reply.status(201).send({ invite, code: `${tenantId}.${token}` });
    },
  );

  // Everything a parent/student needs on one screen, per linked student.
  app.get('/portal', { preHandler: family }, async (req) => {
    const today = colomboToday();
    // Without the live links feature, links already set stay stored but are not shown.
    const { live_links: liveLinks } = (await req.entitlements()).features;
    const children = await req.withTenant(async (trx) => {
      const students = await trx('portal_access as pa')
        .join('students as s', 's.id', 'pa.student_id')
        .where('pa.membership_id', req.tenant!.membershipId)
        .orderBy('s.full_name')
        .select('s.id', 's.full_name as fullName', 's.student_number as studentNumber');
      if (students.length) await ensureSessions(trx, today, addDays(today, 13));
      return Promise.all(
        students.map(async (s) => {
          const batchIds = trx('enrollments')
            .where({ student_id: s.id, status: 'active' })
            .select('batch_id');
          const classes = await trx('batches as b')
            .join('subjects as sub', 'sub.id', 'b.subject_id')
            .whereIn('b.id', batchIds)
            .orderBy('b.name')
            .select('b.id', 'b.name', 'sub.name as subjectName');
          const sessions = await trx('class_sessions as cs')
            .join('batches as b', 'b.id', 'cs.batch_id')
            .leftJoin('schedule_rules as r', 'r.id', 'cs.schedule_rule_id')
            .whereIn('cs.batch_id', batchIds)
            .where('cs.ends_at', '>', trx.fn.now())
            .whereRaw(`(cs.starts_at AT TIME ZONE '${TIME_ZONE}')::date <= ?`, [addDays(today, 13)])
            .orderBy('cs.starts_at')
            .limit(20)
            .select(
              'cs.id',
              'b.name as batchName',
              'cs.starts_at as startsAt',
              'cs.ends_at as endsAt',
              'cs.status',
              'r.room',
              trx.raw('(b.live_url IS NOT NULL) AS "online"'),
              // Unpaid = an issued/part-paid invoice for the class's month. Free cards and
              // months not billed yet are not blocked.
              trx.raw(
                `EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = ?
                   AND i.period = to_char(cs.starts_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')
                   AND i.status IN ('issued', 'part_paid')) AS "feeDue"`,
                [s.id],
              ),
              // The link itself only from 30 min before start until the end, never otherwise.
              trx.raw(
                `CASE WHEN cs.status = 'scheduled'
                   AND now() BETWEEN cs.starts_at - interval '${LINK_EARLY_MINUTES} minutes' AND cs.ends_at
                   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = ?
                     AND i.period = to_char(cs.starts_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')
                     AND i.status IN ('issued', 'part_paid'))
                 THEN b.live_url END AS "liveUrl"`,
                [s.id],
              ),
            );
          const attendance = await trx('attendance_records as a')
            .join('class_sessions as cs', 'cs.id', 'a.session_id')
            .join('batches as b', 'b.id', 'cs.batch_id')
            .where('a.student_id', s.id)
            .orderBy('cs.starts_at', 'desc')
            .limit(20)
            .select('a.status', 'b.name as batchName', 'cs.starts_at as startsAt');
          const invoices = await trx('invoices')
            .where({ student_id: s.id })
            .whereIn('status', ['issued', 'part_paid'])
            .orderBy('due_date')
            .select(
              'invoice_number as invoiceNumber',
              'period',
              trx.raw(`to_char(due_date, 'YYYY-MM-DD') as "dueDate"`),
              'total',
              'paid',
            );
          const payments = await trx('payments')
            .where({ student_id: s.id, status: 'verified' })
            .orderBy('received_at', 'desc')
            .limit(5)
            .select('receipt_number as receiptNumber', 'amount', 'received_at as receivedAt');
          const slips = await trx('payments')
            .where({ student_id: s.id, method: 'slip' })
            .whereNot('status', 'verified')
            .orderBy('received_at', 'desc')
            .limit(5)
            .select(
              'id',
              'amount',
              'status',
              'review_note as reviewNote',
              'received_at as submittedAt',
            );
          const due = invoices.reduce((sum, i) => sum + toCents(i.total) - toCents(i.paid), 0);
          return {
            ...s,
            classes,
            sessions: liveLinks
              ? sessions
              : sessions.map((x) => ({ ...x, online: false, liveUrl: null })),
            attendance,
            invoices,
            payments,
            slips,
            outstanding: fromCents(due),
          };
        }),
      );
    });
    return { children };
  });
}
