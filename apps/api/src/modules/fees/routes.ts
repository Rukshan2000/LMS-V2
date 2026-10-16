import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { amountInput, fromCents, toCents } from '../../lib/money.js';
import { colomboToday } from '../../lib/time.js';
import { nextCounter } from '../students/service.js';
import { generateMonth, getReceipt, recordPayment, refreshInvoices } from './billing.js';

const uuid = z.uuid();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const currentPeriod = () => colomboToday().slice(0, 7);

const param = (req: FastifyRequest, name: string) => {
  const value = (req.params as Record<string, string>)[name];
  if (!uuid.safeParse(value).success) throw notFound();
  return value!;
};

const CONCESSIONS = { free_card: 100, half_card: 50 } as const;

export default async function feeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const managers = app.requireRole('owner', 'admin');
  const desk = app.requireRole('owner', 'admin', 'receptionist');

  // ---- Class fees -----------------------------------------------------------------------
  app.put('/batches/:batchId/fees', { preHandler: managers }, async (req) => {
    const batchId = param(req, 'batchId');
    const body = z
      .object({
        class: amountInput.optional(),
        ac: amountInput.optional(),
        tute: amountInput.optional(),
      })
      .parse(req.body);
    const fees = await req.withTenant(async (trx) => {
      const batch = await trx('batches').where({ id: batchId }).first('id');
      if (!batch) return undefined;
      for (const [kind, amount] of Object.entries(body)) {
        if (amount === undefined) continue;
        await trx('batch_fees')
          .insert({ tenant_id: req.tenant!.id, batch_id: batchId, kind, amount })
          .onConflict(['batch_id', 'kind'])
          .merge({ amount, updated_at: trx.fn.now() });
      }
      return trx('batch_fees').where({ batch_id: batchId }).select('kind', 'amount');
    });
    if (!fees) throw notFound();
    return { fees };
  });

  app.get('/batches/:batchId/fees', { preHandler: desk }, async (req) => {
    const batchId = param(req, 'batchId');
    return {
      fees: await req.withTenant((trx) =>
        trx('batch_fees').where({ batch_id: batchId }).select('kind', 'amount'),
      ),
    };
  });

  // ---- Concessions -------------------------------------------------------------------------
  app.post('/students/:studentId/concessions', { preHandler: managers }, async (req, reply) => {
    const studentId = param(req, 'studentId');
    const body = z
      .object({
        type: z.enum(['free_card', 'half_card', 'percent']),
        percent: z.number().gt(0).max(100).optional(),
        batchId: uuid.nullish(),
        note: z.string().trim().max(200).optional(),
      })
      .refine((b) => b.type !== 'percent' || b.percent, { path: ['percent'], message: 'required' })
      .parse(req.body);
    const percent = body.type === 'percent' ? body.percent! : CONCESSIONS[body.type];
    const concession = await req.withTenant(async (trx) => {
      const [row] = await trx('student_concessions')
        .insert({
          tenant_id: req.tenant!.id,
          student_id: studentId,
          batch_id: body.batchId ?? null,
          type: body.type,
          percent,
          note: body.note || null,
        })
        .onConflict(
          trx.raw(
            `(tenant_id, student_id, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid))`,
          ),
        )
        .merge({ type: body.type, percent, note: body.note || null, updated_at: trx.fn.now() })
        .returning(['id', 'type', 'percent', 'batch_id as batchId', 'note']);
      return row;
    });
    return reply.status(201).send({ concession });
  });

  app.delete(
    '/students/:studentId/concessions/:concessionId',
    { preHandler: managers },
    async (req) => {
      const studentId = param(req, 'studentId');
      const id = param(req, 'concessionId');
      const n = await req.withTenant((trx) =>
        trx('student_concessions').where({ id, student_id: studentId }).delete(),
      );
      if (!n) throw notFound();
      return { removed: true };
    },
  );

  // ---- Invoices ------------------------------------------------------------------------------
  app.post('/invoices/generate', { preHandler: desk }, async (req) => {
    const body = z.object({ period: period.default(currentPeriod) }).parse(req.body ?? {});
    return req.withTenant((trx) => generateMonth(trx, req.tenant!.id, body.period));
  });

  // One-off charge, e.g. admission fee.
  app.post('/invoices', { preHandler: desk }, async (req, reply) => {
    const body = z
      .object({
        studentId: uuid,
        dueDate: z.iso.date().optional(),
        lines: z
          .array(
            z.object({
              kind: z.enum(['admission', 'late', 'other']),
              description: z.string().trim().min(1).max(200),
              amount: amountInput,
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(req.body);
    const invoice = await req.withTenant(async (trx) => {
      const student = await trx('students').where({ id: body.studentId }).first('id');
      if (!student) return undefined;
      const number = await nextCounter(trx, req.tenant!.id, 'invoice', 0);
      const [inv] = await trx('invoices')
        .insert({
          tenant_id: req.tenant!.id,
          student_id: body.studentId,
          invoice_number: String(number),
          due_date: body.dueDate ?? colomboToday(),
        })
        .returning('id');
      await trx('invoice_lines').insert(
        body.lines.map((l) => ({ tenant_id: req.tenant!.id, invoice_id: inv.id, ...l })),
      );
      await refreshInvoices(trx, { ids: [inv.id] });
      return trx('invoices')
        .where({ id: inv.id })
        .first('id', 'invoice_number as invoiceNumber', 'total', 'status');
    });
    if (!invoice) throw notFound();
    return reply.status(201).send({ invoice });
  });

  app.post('/invoices/:invoiceId/void', { preHandler: managers }, async (req) => {
    const id = param(req, 'invoiceId');
    await req.withTenant(async (trx) => {
      const inv = await trx('invoices').where({ id }).forUpdate().first('paid', 'status');
      if (!inv) throw notFound();
      if (toCents(inv.paid) > 0)
        throw new HttpError(409, 'invoice_has_payments', 'Invoice has payments');
      await trx('invoices').where({ id }).update({ status: 'void', updated_at: trx.fn.now() });
    });
    return { voided: true };
  });

  // Everything about one student's fees: concessions, invoices with lines, payments.
  app.get('/students/:studentId/fees', { preHandler: desk }, async (req) => {
    const studentId = param(req, 'studentId');
    return req.withTenant(async (trx) => {
      const concessions = await trx('student_concessions as c')
        .leftJoin('batches as b', 'b.id', 'c.batch_id')
        .where('c.student_id', studentId)
        .select(
          'c.id',
          'c.type',
          'c.percent',
          'c.batch_id as batchId',
          'b.name as batchName',
          'c.note',
        );
      // Amounts inside JSON are cast to text: json_build_object turns numeric into a JSON
      // number, which would become a float in the browser.
      const invoices = await trx('invoices')
        .where({ student_id: studentId })
        .orderBy('due_date', 'desc')
        .select(
          'id',
          'invoice_number as invoiceNumber',
          'period',
          trx.raw(`to_char(due_date, 'YYYY-MM-DD') as "dueDate"`),
          'total',
          'paid',
          'status',
          trx.raw(
            `(SELECT json_agg(json_build_object('kind', l.kind, 'description', l.description, 'amount', l.amount::text) ORDER BY l.amount DESC)
              FROM invoice_lines l WHERE l.invoice_id = invoices.id) AS lines`,
          ),
        );
      // Pending/rejected bank slips live on the slips page.
      const payments = await trx('payments')
        .where({ student_id: studentId, status: 'verified' })
        .orderBy('received_at', 'desc')
        .select(
          'id',
          'receipt_number as receiptNumber',
          'amount',
          'method',
          'status',
          'received_at as receivedAt',
        );
      const due = invoices
        .filter((i) => i.status === 'issued' || i.status === 'part_paid')
        .reduce((sum, i) => sum + toCents(i.total) - toCents(i.paid), 0);
      return { concessions, invoices, payments, outstanding: fromCents(due) };
    });
  });

  // ---- Payments --------------------------------------------------------------------------------
  app.post('/payments', { preHandler: desk }, async (req, reply) => {
    const body = z
      .object({
        studentId: uuid,
        amount: amountInput,
        method: z.enum(['cash', 'bank_transfer']).default('cash'),
        reference: z.string().trim().max(100).nullish(),
        clientRef: uuid,
        invoiceIds: z.array(uuid).max(50).optional(),
      })
      .parse(req.body);
    const result = await req.withTenant(async (trx) => {
      const recorded = await recordPayment(trx, req.tenant!.id, req.tenant!.membershipId, body);
      return recorded && { ...recorded, receipt: await getReceipt(trx, recorded.id) };
    });
    if (!result) throw notFound();
    return reply
      .status(result.duplicate ? 200 : 201)
      .send({ duplicate: result.duplicate, receipt: result.receipt });
  });

  app.get('/payments/:paymentId', { preHandler: desk }, async (req) => {
    const id = param(req, 'paymentId');
    const receipt = await req.withTenant((trx) => getReceipt(trx, id));
    if (!receipt) throw notFound();
    return { receipt };
  });

  // ---- Month overview and not-paid list ------------------------------------------------------------
  app.get('/fees/month', { preHandler: desk }, async (req) => {
    const query = z.object({ period: period.default(currentPeriod) }).parse(req.query);
    return req.withTenant(async (trx) => {
      const summary = await trx('invoices')
        .where({ period: query.period })
        .whereNot('status', 'void')
        .first(
          trx.raw('count(*)::int AS invoices'),
          trx.raw('COALESCE(sum(total), 0) AS billed'),
          trx.raw('COALESCE(sum(paid), 0) AS collected'),
          trx.raw('COALESCE(sum(total - paid), 0) AS outstanding'),
        );
      const unpaid = await trx('invoices as i')
        .join('students as st', 'st.id', 'i.student_id')
        .where('i.period', query.period)
        .whereIn('i.status', ['issued', 'part_paid'])
        .orderByRaw('lower(st.full_name)')
        .select(
          'i.id as invoiceId',
          'st.id as studentId',
          'st.student_number as studentNumber',
          'st.full_name as fullName',
          'i.total',
          'i.paid',
          trx.raw('(i.total - i.paid) AS balance'),
          trx.raw(`to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate"`),
          trx.raw(
            `COALESCE((SELECT json_agg(json_build_object('fullName', g.full_name, 'phone', g.phone) ORDER BY g.full_name)
               FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = st.id), '[]') AS guardians`,
          ),
        );
      return { period: query.period, summary, unpaid };
    });
  });
}
