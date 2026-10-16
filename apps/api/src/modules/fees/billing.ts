import type { Knex } from 'knex';
import { HttpError } from '../../lib/http-error.js';
import { fromCents, toCents } from '../../lib/money.js';
import { nextCounter } from '../students/service.js';

/** Recalculate total and status of the given invoices from their lines and `paid`. */
export async function refreshInvoices(
  trx: Knex.Transaction,
  where: { period?: string; ids?: string[] },
) {
  await trx.raw(
    `WITH sums AS (
       SELECT i.id, COALESCE(sum(l.amount), 0) AS total
       FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id = i.id
       WHERE i.status <> 'void' ${where.period ? 'AND i.period = ?' : 'AND i.id = ANY(?::uuid[])'}
       GROUP BY i.id)
     UPDATE invoices i SET
       total = GREATEST(sums.total, 0),
       status = CASE WHEN i.paid >= GREATEST(sums.total, 0) THEN 'paid'
                     WHEN i.paid > 0 THEN 'part_paid' ELSE 'issued' END,
       updated_at = now()
     FROM sums WHERE sums.id = i.id`,
    [where.period ?? where.ids ?? []],
  );
}

/**
 * Monthly billing for `period` (YYYY-MM). Safe to run any number of times:
 * one invoice per student per month, and each class fee line is added at most once
 * (a student who joins a class later in the month gets the new line on the next run).
 */
export async function generateMonth(trx: Knex.Transaction, tenantId: string, period: string) {
  const students: string[] = await trx('enrollments as e')
    .join('batches as b', 'b.id', 'e.batch_id')
    .join('students as st', 'st.id', 'e.student_id')
    .join('batch_fees as bf', 'bf.batch_id', 'b.id')
    .where({ 'e.status': 'active', 'b.status': 'active', 'st.status': 'active' })
    .where('bf.amount', '>', 0)
    .distinct()
    .pluck('e.student_id');

  const existing = new Set<string>(
    await trx('invoices').where({ period }).whereNot('status', 'void').pluck('student_id'),
  );
  let invoicesCreated = 0;
  for (const studentId of students) {
    if (existing.has(studentId)) continue;
    const number = await nextCounter(trx, tenantId, 'invoice', 0);
    await trx('invoices').insert({
      tenant_id: tenantId,
      student_id: studentId,
      invoice_number: String(number),
      period,
      due_date: `${period}-05`,
    });
    invoicesCreated++;
  }

  // Fee lines for every active class of each invoiced student.
  const fees = await trx.raw(
    `INSERT INTO invoice_lines (tenant_id, invoice_id, batch_id, kind, description, amount)
     SELECT i.tenant_id, i.id, b.id, bf.kind, b.name, bf.amount
     FROM invoices i
     JOIN enrollments e ON e.student_id = i.student_id AND e.status = 'active'
     JOIN batches b ON b.id = e.batch_id AND b.status = 'active'
     JOIN batch_fees bf ON bf.batch_id = b.id AND bf.amount > 0
     WHERE i.period = ? AND i.status <> 'void'
     ON CONFLICT (invoice_id, batch_id, kind) WHERE batch_id IS NOT NULL DO NOTHING`,
    [period],
  );
  // Concessions apply to the class fee only (AC and tute fees are still charged).
  // A class-specific concession wins over an "all classes" one.
  const concessions = await trx.raw(
    `INSERT INTO invoice_lines (tenant_id, invoice_id, batch_id, kind, description, amount)
     SELECT l.tenant_id, l.invoice_id, l.batch_id, 'concession', c.type,
            -round(l.amount * c.percent / 100, 2)
     FROM invoice_lines l
     JOIN invoices i ON i.id = l.invoice_id AND i.period = ? AND i.status <> 'void'
     JOIN LATERAL (
       SELECT sc.type, sc.percent FROM student_concessions sc
       WHERE sc.student_id = i.student_id AND (sc.batch_id = l.batch_id OR sc.batch_id IS NULL)
       ORDER BY sc.batch_id NULLS LAST LIMIT 1) c ON true
     WHERE l.kind = 'class'
     ON CONFLICT (invoice_id, batch_id, kind) WHERE batch_id IS NOT NULL DO NOTHING`,
    [period],
  );
  await refreshInvoices(trx, { period });
  return { invoicesCreated, linesAdded: (fees.rowCount ?? 0) + (concessions.rowCount ?? 0) };
}

export interface PaymentInput {
  studentId: string;
  amount: string;
  method: 'cash' | 'bank_transfer';
  reference?: string | null;
  clientRef: string;
  invoiceIds?: string[];
}

/** Lock the student's open invoices (oldest due first) and check `cents` fits what is due. */
async function lockOpenInvoices(
  trx: Knex.Transaction,
  studentId: string,
  cents: number,
  invoiceIds?: string[],
) {
  const open: { id: string; total: string; paid: string }[] = await trx('invoices')
    .where({ student_id: studentId })
    .whereIn('status', ['issued', 'part_paid'])
    .modify((q) => {
      if (invoiceIds?.length) q.whereIn('id', invoiceIds);
    })
    .orderBy([{ column: 'due_date' }, { column: 'created_at' }])
    .forUpdate()
    .select('id', 'total', 'paid');
  const outstanding = open.reduce((sum, i) => sum + toCents(i.total) - toCents(i.paid), 0);
  if (outstanding === 0) throw new HttpError(409, 'nothing_due', 'Nothing is due');
  if (cents > outstanding) {
    throw new HttpError(409, 'overpayment', 'Amount is more than what is due', {
      outstanding: fromCents(outstanding),
    });
  }
  return open;
}

/** Spread a payment over the locked open invoices. */
async function allocate(
  trx: Knex.Transaction,
  tenantId: string,
  paymentId: string,
  open: { id: string; total: string; paid: string }[],
  cents: number,
) {
  let remaining = cents;
  for (const inv of open) {
    if (remaining === 0) break;
    const take = Math.min(remaining, toCents(inv.total) - toCents(inv.paid));
    if (take === 0) continue;
    await trx('payment_allocations').insert({
      tenant_id: tenantId,
      payment_id: paymentId,
      invoice_id: inv.id,
      amount: fromCents(take),
    });
    // Increment in SQL (not "set to what we read"): if locking ever failed, the
    // paid <= total CHECK would reject an over-allocation instead of hiding it.
    await trx('invoices')
      .where({ id: inv.id })
      .increment('paid', fromCents(take) as unknown as number);
    remaining -= take;
  }
  await refreshInvoices(trx, { ids: open.map((i) => i.id) });
}

/**
 * Record a verified payment and allocate it to the student's open invoices, oldest due first.
 * The student row is locked so concurrent payments for one student run one at a time, and a
 * repeated clientRef returns the first payment instead of recording it twice.
 */
export async function recordPayment(
  trx: Knex.Transaction,
  tenantId: string,
  membershipId: string,
  input: PaymentInput,
) {
  const student = await trx('students').where({ id: input.studentId }).forUpdate().first('id');
  if (!student) return undefined;

  const previous = await trx('payments').where({ client_ref: input.clientRef }).first('id');
  if (previous) return { id: previous.id as string, duplicate: true };

  const cents = toCents(input.amount);
  const open = await lockOpenInvoices(trx, input.studentId, cents, input.invoiceIds);
  const number = await nextCounter(trx, tenantId, 'receipt', 0);
  const [payment] = await trx('payments')
    .insert({
      tenant_id: tenantId,
      student_id: input.studentId,
      receipt_number: String(number),
      amount: input.amount,
      method: input.method,
      reference: input.reference || null,
      client_ref: input.clientRef,
      received_by_membership_id: membershipId,
    })
    .returning('id');
  await allocate(trx, tenantId, payment.id, open, cents);
  return { id: payment.id as string, duplicate: false };
}

/**
 * Verify a pending bank slip: allocate it like a desk payment and give it a receipt number.
 * `amount` corrects a mistyped slip amount. Returns false if it is not pending (any more).
 */
export async function verifySlip(
  trx: Knex.Transaction,
  tenantId: string,
  membershipId: string,
  paymentId: string,
  amount?: string,
) {
  const pending = await trx('payments')
    .where({ id: paymentId, status: 'pending' })
    .first('student_id', 'amount');
  if (!pending) return false;
  // Same lock order as recordPayment (student first), then re-check under the lock.
  await trx('students').where({ id: pending.student_id }).forUpdate().first('id');
  const slip = await trx('payments')
    .where({ id: paymentId, status: 'pending' })
    .forUpdate()
    .first('amount');
  if (!slip) return false;
  const finalAmount = amount ?? slip.amount;
  const open = await lockOpenInvoices(trx, pending.student_id, toCents(finalAmount));
  const number = await nextCounter(trx, tenantId, 'receipt', 0);
  await trx('payments')
    .where({ id: paymentId })
    .update({
      status: 'verified',
      amount: finalAmount,
      receipt_number: String(number),
      received_by_membership_id: membershipId,
      reviewed_at: trx.fn.now(),
    });
  await allocate(trx, tenantId, paymentId, open, toCents(finalAmount));
  return true;
}

export async function getReceipt(trx: Knex.Transaction, paymentId: string) {
  const payment = await trx('payments as p')
    .join('students as st', 'st.id', 'p.student_id')
    .leftJoin('tenant_memberships as m', 'm.id', 'p.received_by_membership_id')
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .where('p.id', paymentId)
    .first(
      'p.id',
      'p.receipt_number as receiptNumber',
      'p.amount',
      'p.method',
      'p.status',
      'p.reference',
      'p.received_at as receivedAt',
      'st.id as studentId',
      'st.student_number as studentNumber',
      'st.full_name as studentName',
      'u.full_name as receivedBy',
    );
  if (!payment) return undefined;
  const allocations = await trx('payment_allocations as a')
    .join('invoices as i', 'i.id', 'a.invoice_id')
    .where('a.payment_id', paymentId)
    .orderBy('i.due_date')
    .select(
      'i.id as invoiceId',
      'i.invoice_number as invoiceNumber',
      'i.period',
      'a.amount',
      'i.total',
      'i.paid',
      'i.status',
    );
  return { ...payment, allocations };
}
