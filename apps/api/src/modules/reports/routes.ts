import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { toCsv } from '../../lib/csv.js';
import { colomboToday, TIME_ZONE } from '../../lib/time.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const MAX_MONTHS = 24;

/** ?from=YYYY-MM&to=YYYY-MM (default: this month), at most 24 months. */
function monthRange(query: unknown) {
  const now = colomboToday().slice(0, 7);
  const { from, to } = z.object({ from: month.default(now), to: month.default(now) }).parse(query);
  const count = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5) - +from.slice(5)) + 1;
  if (count < 1 || count > MAX_MONTHS) {
    throw new HttpError(400, 'invalid_range', 'Choose at most 24 months');
  }
  return { from, to };
}

// Colombo-local month of a timestamp column, for grouping and filtering.
const monthOf = (col: string) => `to_char(${col} AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')`;

function sendCsv(reply: FastifyReply, name: string, rows: (string | number | null)[][]) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}-${colomboToday()}.csv"`)
    .send(toCsv(rows));
}

/** Prefix /api/v1/tenants/:tenantId/reports. Owners and admins only. */
export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  app.addHook('preHandler', app.requireRole('owner', 'admin'));

  app.get('/summary', async (req) => {
    const { from, to } = monthRange(req.query);
    return req.withTenant(async (trx) => {
      // Billed vs paid per fee month (invoice period).
      const months = await trx('invoices')
        .whereNot('status', 'void')
        .whereBetween('period', [from, to])
        .groupBy('period')
        .orderBy('period')
        .select(
          'period',
          trx.raw('count(*)::int AS invoices'),
          trx.raw('sum(total)::text AS billed'),
          trx.raw('sum(paid)::text AS paid'),
          trx.raw('sum(total - paid)::text AS outstanding'),
        );
      // Money actually received per calendar month, by method.
      const received = await trx('payments')
        .where('status', 'verified')
        .whereRaw(`${monthOf('received_at')} BETWEEN ? AND ?`, [from, to])
        .groupByRaw(`${monthOf('received_at')}, method`)
        .orderByRaw(`${monthOf('received_at')}, method`)
        .select(
          trx.raw(`${monthOf('received_at')} AS month`),
          'method',
          trx.raw('count(*)::int AS payments'),
          trx.raw('sum(amount)::text AS amount'),
        );
      // Attendance per class over finished, not cancelled classes in the range.
      const attendance = await trx('class_sessions as cs')
        .join('batches as b', 'b.id', 'cs.batch_id')
        .leftJoin('attendance_records as a', 'a.session_id', 'cs.id')
        .where('cs.status', 'scheduled')
        .where('cs.ends_at', '<', trx.fn.now())
        .whereRaw(`${monthOf('cs.starts_at')} BETWEEN ? AND ?`, [from, to])
        .groupBy('b.id', 'b.name')
        .orderBy('b.name')
        .select(
          'b.id as batchId',
          'b.name',
          trx.raw('count(DISTINCT cs.id)::int AS sessions'),
          trx.raw(`count(*) FILTER (WHERE a.status = 'present')::int AS present`),
          trx.raw(`count(*) FILTER (WHERE a.status = 'late')::int AS late`),
          trx.raw(`count(*) FILTER (WHERE a.status = 'absent')::int AS absent`),
          trx.raw(
            `(SELECT count(*) FROM enrollments e WHERE e.batch_id = b.id AND e.status = 'active')::int AS enrolled`,
          ),
        );
      return { from, to, months, received, attendance };
    });
  });

  app.get('/payments.csv', async (req, reply) => {
    const { from, to } = monthRange(req.query);
    const rows = await req.withTenant((trx) =>
      trx('payments as p')
        .join('students as s', 's.id', 'p.student_id')
        .leftJoin('tenant_memberships as m', 'm.id', 'p.received_by_membership_id')
        .leftJoin('users as u', 'u.id', 'm.user_id')
        .where('p.status', 'verified')
        .whereRaw(`${monthOf('p.received_at')} BETWEEN ? AND ?`, [from, to])
        .orderBy('p.received_at')
        .select(
          trx.raw(
            `to_char(p.received_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD HH24:MI') AS date`,
          ),
          'p.receipt_number',
          's.student_number',
          's.full_name',
          trx.raw('p.amount::text AS amount'),
          'p.method',
          'p.reference',
          'u.full_name as received_by',
        ),
    );
    return sendCsv(reply, 'payments', [
      [
        'date',
        'receipt',
        'student_number',
        'student',
        'amount',
        'method',
        'reference',
        'received_by',
      ],
      ...rows.map((r) => [
        r.date,
        r.receipt_number,
        r.student_number,
        r.full_name,
        r.amount,
        r.method,
        r.reference,
        r.received_by,
      ]),
    ]);
  });

  app.get('/unpaid.csv', async (req, reply) => {
    const rows = await req.withTenant((trx) =>
      trx('invoices as i')
        .join('students as s', 's.id', 'i.student_id')
        .whereIn('i.status', ['issued', 'part_paid'])
        .orderBy(['s.student_number', 'i.due_date'])
        .select(
          's.student_number',
          's.full_name',
          trx.raw(`(SELECT string_agg(g.full_name || ' ' || g.phone, '; ' ORDER BY g.full_name)
            FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = s.id) AS guardians`),
          'i.invoice_number',
          'i.period',
          trx.raw(`to_char(i.due_date, 'YYYY-MM-DD') AS due_date`),
          trx.raw('i.total::text AS total'),
          trx.raw('i.paid::text AS paid'),
          trx.raw('(i.total - i.paid)::text AS balance'),
        ),
    );
    return sendCsv(reply, 'unpaid', [
      [
        'student_number',
        'student',
        'guardians',
        'invoice',
        'month',
        'due',
        'total',
        'paid',
        'balance',
      ],
      ...rows.map((r) => [
        r.student_number,
        r.full_name,
        r.guardians,
        r.invoice_number,
        r.period,
        r.due_date,
        r.total,
        r.paid,
        r.balance,
      ]),
    ]);
  });

  app.get('/students.csv', async (req, reply) => {
    const rows = await req.withTenant((trx) =>
      trx('students as s')
        .orderBy('s.student_number')
        .select(
          's.student_number',
          's.full_name',
          's.phone',
          's.grade',
          's.school',
          's.status',
          trx.raw(`(SELECT string_agg(g.full_name || ' ' || g.phone, '; ' ORDER BY g.full_name)
            FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = s.id) AS guardians`),
          trx.raw(`(SELECT string_agg(b.name, '; ' ORDER BY b.name)
            FROM enrollments e JOIN batches b ON b.id = e.batch_id
            WHERE e.student_id = s.id AND e.status = 'active') AS classes`),
        ),
    );
    return sendCsv(reply, 'students', [
      ['student_number', 'name', 'phone', 'grade', 'school', 'status', 'guardians', 'classes'],
      ...rows.map((r) => [
        r.student_number,
        r.full_name,
        r.phone,
        r.grade,
        r.school,
        r.status,
        r.guardians,
        r.classes,
      ]),
    ]);
  });
}
