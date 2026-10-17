// Billing service: the only code that reads accounts, price books, overrides and subscription
// invoices (docs/SAAS_PLAN.md §4 rule 3). Other modules use the functions exported by index.ts.
import type { Knex } from 'knex';
import { HttpError } from '../../lib/http-error.js';
import { fromCents, toCents } from '../../lib/money.js';
import { addDays, colomboToday } from '../../lib/time.js';
import { CAP_HEAD, CAPS, type Cap, type Feature, type Head, type Values } from './catalogue.js';
import { computeInvoice, monthDays } from './invoice.js';
import { resolveAccountState, resolveValues, type ResolvedState } from './resolve.js';
import { countAccountHeads, usageRows } from './usage.js';

interface AccountRow {
  id: string;
  price_book: string;
  trial_ends_at: Date | null;
  suspended_at: Date | null;
}

export interface Settings {
  trialDays: number;
  graceDays: number;
  invoiceDueDays: number;
  trialCaps: Record<string, unknown>;
}

const lock = (trx: Knex.Transaction, key: string) =>
  trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [key]);

export async function loadSettings(trx: Knex.Transaction): Promise<Settings> {
  const rows: { key: string; value: unknown }[] = await trx('platform_settings').select(
    'key',
    'value',
  );
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    trialDays: Number(s.trial_days ?? 30),
    graceDays: Number(s.grace_days ?? 7),
    invoiceDueDays: Number(s.invoice_due_days ?? 7),
    trialCaps: (s.trial_caps as Record<string, unknown>) ?? {},
  };
}

/** Price book values with the account's unexpired overrides applied. */
async function accountValues(
  trx: Knex.Transaction,
  account: Pick<AccountRow, 'id' | 'price_book'>,
  now = new Date(),
): Promise<Values> {
  const book = await trx('price_books').where({ key: account.price_book }).first('values');
  const overrides = await trx('account_overrides')
    .where({ account_id: account.id })
    .select('key', 'value', 'expires_at as expiresAt');
  return resolveValues(book?.values ?? {}, overrides, now);
}

interface AccountContext {
  account: AccountRow;
  state: ResolvedState;
  values: Values;
}

async function accountContext(trx: Knex.Transaction, account: AccountRow): Promise<AccountContext> {
  // Sequential: one transaction = one connection, which runs one query at a time anyway.
  const settings = await loadSettings(trx);
  const values = await accountValues(trx, account);
  const invoices = await trx('subscription_invoices as i')
    .where({ 'i.account_id': account.id, 'i.status': 'open' })
    .select(
      'i.number',
      'i.total',
      trx.raw(`to_char(i.due_date, 'YYYY-MM-DD') AS due_date`),
      trx.raw(
        `(SELECT COALESCE(sum(p.amount), 0) FROM subscription_payments p WHERE p.invoice_id = i.id) AS paid`,
      ),
    );
  const openInvoices = invoices.map(
    (i: { number: string; total: string; due_date: string; paid: string }) => ({
      number: i.number,
      dueDate: i.due_date,
      amountDueCents: Math.max(0, toCents(i.total) - toCents(i.paid)),
    }),
  );
  return {
    account,
    state: resolveAccountState(
      { trialEndsAt: account.trial_ends_at, suspendedAt: account.suspended_at },
      openInvoices,
      settings,
    ),
    values,
  };
}

async function contextForTenant(trx: Knex.Transaction, tenantId: string) {
  const account: AccountRow = await trx('accounts as a')
    .join('tenants as t', 't.account_id', 'a.id')
    .where('t.id', tenantId)
    .first('a.id', 'a.price_book', 'a.trial_ends_at', 'a.suspended_at');
  return accountContext(trx, account);
}

function assertWritable({ state }: AccountContext) {
  if (!state.writable) {
    throw new HttpError(403, 'account_suspended', 'This account is suspended. Contact support.');
  }
}

function assertCanAddHeads(ctx: AccountContext) {
  assertWritable(ctx);
  if (!ctx.state.canAddHeads) {
    throw new HttpError(
      403,
      'account_restricted',
      'An invoice is overdue. Pay it to add more people.',
      { amountDue: fromCents(ctx.state.amountDueCents), invoiceNumber: ctx.state.overdueInvoice },
    );
  }
}

/** Refuse if adding `adding` more of the cap's items would go over it. Locks per account + cap. */
async function assertCap(
  trx: Knex.Transaction,
  ctx: AccountContext,
  cap: Cap,
  adding: number,
  count: () => Promise<number>,
) {
  const limit = ctx.values.caps[cap];
  if (limit === null) return;
  await lock(trx, `cap:${cap}:${ctx.account.id}`);
  const used = await count();
  if (used + adding > limit) {
    throw new HttpError(403, 'plan_limit', `The ${cap} limit for this account is reached`, {
      key: `cap.${cap}`,
      limit,
      used,
    });
  }
}

const capForHead = (head: Head): Exclude<Cap, 'institutes'> | undefined =>
  (Object.entries(CAP_HEAD) as [Exclude<Cap, 'institutes'>, Head][]).find(
    ([, h]) => h === head,
  )?.[0];

/**
 * Check before adding students / teachers / parents. Call inside the write transaction, with the
 * tenant as context; the lock is held until commit, so two desks cannot both take the last place.
 */
export async function assertCanAddHead(
  trx: Knex.Transaction,
  tenantId: string,
  head: Head,
  adding = 1,
) {
  const ctx = await contextForTenant(trx, tenantId);
  assertCanAddHeads(ctx);
  const cap = capForHead(head);
  if (cap) {
    await assertCap(
      trx,
      ctx,
      cap,
      adding,
      async () => (await countAccountHeads(trx, ctx.account.id))[head],
    );
  }
}

export async function assertFeature(trx: Knex.Transaction, tenantId: string, feature: Feature) {
  const ctx = await contextForTenant(trx, tenantId);
  if (!ctx.values.features[feature]) {
    throw new HttpError(403, 'feature_locked', 'This feature is not included in your plan', {
      feature,
    });
  }
}

/** What the web app needs: state, features and caps (with counts for owners/admins). */
export async function getEntitlements(
  trx: Knex.Transaction,
  tenantId: string,
  { withUsage }: { withUsage: boolean },
) {
  const { account, state, values } = await contextForTenant(trx, tenantId);
  const used = withUsage ? await countAccountHeads(trx, account.id) : undefined;
  const usedFor = (cap: Cap) => (cap === 'institutes' ? used?.institutes : used?.[CAP_HEAD[cap]]);
  return {
    state: state.state,
    trialEndsAt: state.trialEndsAt,
    daysLeft: state.daysLeft,
    writable: state.writable,
    canAddHeads: state.canAddHeads,
    amountDue: fromCents(state.amountDueCents),
    features: values.features,
    caps: Object.fromEntries(
      CAPS.map((cap) => [cap, { limit: values.caps[cap], ...(used && { used: usedFor(cap) }) }]),
    ) as Record<Cap, { limit: number | null; used?: number }>,
  };
}

/**
 * The account a new institute belongs to: the one this user owns, else an unclaimed account the
 * platform admin created for this phone, else a new self-service account with a trial (trial caps
 * are overrides that expire with it). Then checks the institutes cap.
 */
export async function accountForNewInstitute(
  trx: Knex.Transaction,
  user: { id: string; phone: string },
  name: string,
): Promise<string> {
  await lock(trx, `account-owner:${user.id}`);
  let account: AccountRow | undefined = await trx('accounts')
    .where({ owner_user_id: user.id })
    .first('id', 'price_book', 'trial_ends_at', 'suspended_at');
  if (!account) {
    [account] = await trx('accounts')
      .whereIn(
        'id',
        trx('accounts')
          .whereNull('owner_user_id')
          .where({ owner_phone: user.phone })
          .orderBy('created_at')
          .limit(1)
          .select('id'),
      )
      .update({ owner_user_id: user.id, updated_at: trx.fn.now() })
      .returning(['id', 'price_book', 'trial_ends_at', 'suspended_at']);
  }
  if (!account) {
    const settings = await loadSettings(trx);
    const book = await trx('price_books').where({ is_default: true }).first('key');
    const trialEndsAt = new Date(Date.now() + settings.trialDays * 86400_000);
    [account] = await trx('accounts')
      .insert({
        name,
        owner_user_id: user.id,
        owner_phone: user.phone,
        price_book: book.key,
        trial_ends_at: trialEndsAt,
      })
      .returning(['id', 'price_book', 'trial_ends_at', 'suspended_at']);
    const caps = Object.entries(settings.trialCaps);
    if (caps.length) {
      await trx('account_overrides').insert(
        caps.map(([key, value]) => ({
          account_id: account!.id,
          key,
          value: JSON.stringify(value),
          expires_at: trialEndsAt,
          note: 'Trial caps',
        })),
      );
    }
  }
  const ctx = await accountContext(trx, account!);
  assertCanAddHeads(ctx);
  await assertCap(trx, ctx, 'institutes', 1, async () =>
    Number(
      (await trx('tenants').where({ account_id: ctx.account.id }).count({ n: '*' }).first())?.n ??
        0,
    ),
  );
  return ctx.account.id;
}

// ---- Subscription invoices (docs/SAAS_PLAN.md §6.1). Platform admin actions, each audited in
// the same transaction (§4 rule 9).

export interface Actor {
  userId: string;
  ip?: string;
}

const audit = (
  trx: Knex.Transaction,
  actor: Actor,
  accountId: string,
  action: string,
  before: unknown,
  after: unknown,
) =>
  trx('platform_audit').insert({
    actor_user_id: actor.userId,
    account_id: accountId,
    action,
    before: before === null ? null : JSON.stringify(before),
    after: JSON.stringify(after),
    ip: actor.ip ?? null,
  });

export interface GeneratedInvoice {
  id: string;
  accountId: string;
  number: string;
  total: string;
  dueDate: string;
}

/**
 * One invoice per account for a finished month. Idempotent: an account that already has an
 * invoice for the period is skipped (and UNIQUE (account_id, period) backs that up), so running
 * it twice does nothing. Accounts with nothing to bill (trial all month, total 0) get no invoice.
 * Each account has its own transaction, so one failure does not undo the others.
 */
export async function generateInvoices(
  db: Knex,
  period: string,
  actor: Actor,
  now = new Date(),
): Promise<GeneratedInvoice[]> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period >= colomboToday(now).slice(0, 7)) {
    throw new HttpError(400, 'invalid_period', 'Only a finished month (YYYY-MM) can be invoiced');
  }
  const accountIds: string[] = await db('accounts').orderBy('created_at').pluck('id');
  const generated: GeneratedInvoice[] = [];
  for (const accountId of accountIds) {
    const invoice = await db.transaction((trx) =>
      generateInvoice(trx, accountId, period, actor, now),
    );
    if (invoice) generated.push(invoice);
  }
  return generated;
}

async function generateInvoice(
  trx: Knex.Transaction,
  accountId: string,
  period: string,
  actor: Actor,
  now: Date,
): Promise<GeneratedInvoice | null> {
  await lock(trx, `invoice:${accountId}`);
  if (await trx('subscription_invoices').where({ account_id: accountId, period }).first('id')) {
    return null;
  }
  const account = await trx('accounts')
    .where({ id: accountId })
    .first('id', 'price_book', 'trial_ends_at');
  const days = monthDays(period);
  const rows = await usageRows(trx, accountId, days[0]!, days.at(-1)!);
  // Prices as they are now; the invoice keeps them, later changes never touch it.
  const computed = computeInvoice(
    rows,
    await accountValues(trx, account, now),
    account.trial_ends_at,
    period,
  );
  if (!computed || computed.totalCents === 0) return null;

  // Numbers run per period: S-2026-09-0001, S-2026-09-0002, …
  await lock(trx, `invoice-number:${period}`);
  const issued = await trx('subscription_invoices').where({ period }).count({ n: '*' }).first();
  const settings = await loadSettings(trx);
  const [row] = await trx('subscription_invoices')
    .insert({
      account_id: accountId,
      number: `S-${period}-${String(Number(issued?.n ?? 0) + 1).padStart(4, '0')}`,
      period,
      lines: JSON.stringify(computed.lines),
      total: computed.total,
      due_date: addDays(colomboToday(now), settings.invoiceDueDays),
      generated_by: actor.userId,
    })
    .returning([
      'id',
      'account_id as accountId',
      'number',
      'total',
      trx.raw(`to_char(due_date, 'YYYY-MM-DD') AS "dueDate"`),
    ]);
  await audit(trx, actor, accountId, 'invoice.generate', null, {
    number: row.number,
    period,
    lines: computed.lines,
    total: row.total,
    dueDate: row.dueDate,
  });
  return row;
}

const invoiceNotFound = () => new HttpError(404, 'not_found', 'Invoice not found');

/**
 * Record a bank transfer against an invoice. Part payments add up; the invoice is `paid` when
 * they reach its total. The same `clientRef` records once (a retry returns the first result).
 */
export async function recordPayment(
  db: Knex,
  invoiceId: string,
  payment: { amount: string; reference: string; clientRef: string },
  actor: Actor,
): Promise<{ paymentId: string; status: string; amountDue: string }> {
  let amountCents: number;
  try {
    amountCents = toCents(payment.amount);
  } catch {
    amountCents = 0;
  }
  if (amountCents <= 0) throw new HttpError(400, 'invalid_amount', 'Amount must be above 0');

  return db.transaction(async (trx) => {
    const invoice = await trx('subscription_invoices')
      .where({ id: invoiceId })
      .forUpdate()
      .first('id', 'account_id', 'number', 'total', 'status');
    if (!invoice) throw invoiceNotFound();
    const paidCents = async () =>
      toCents(
        (
          await trx('subscription_payments')
            .where({ invoice_id: invoice.id })
            .first(trx.raw('COALESCE(sum(amount), 0)::text AS paid'))
        ).paid,
      );
    const totalCents = toCents(invoice.total);

    const existing = await trx('subscription_payments')
      .where({ client_ref: payment.clientRef })
      .first('id', 'invoice_id');
    if (existing) {
      if (existing.invoice_id !== invoice.id) {
        throw new HttpError(409, 'client_ref_used', 'This payment was recorded on another invoice');
      }
      const due = Math.max(0, totalCents - (await paidCents()));
      return { paymentId: existing.id, status: invoice.status, amountDue: fromCents(due) };
    }
    if (invoice.status !== 'open') {
      throw new HttpError(409, 'invoice_not_open', `Invoice is ${invoice.status}`);
    }
    const before = await paidCents();
    const due = totalCents - before;
    if (amountCents > due) {
      throw new HttpError(400, 'amount_exceeds_due', `Only ${fromCents(due)} is due`, {
        amountDue: fromCents(due),
      });
    }
    const [{ id }] = await trx('subscription_payments')
      .insert({
        invoice_id: invoice.id,
        amount: fromCents(amountCents),
        reference: payment.reference,
        client_ref: payment.clientRef,
        recorded_by: actor.userId,
      })
      .returning('id');
    const status = amountCents === due ? 'paid' : 'open';
    if (status === 'paid') {
      await trx('subscription_invoices').where({ id: invoice.id }).update({ status });
    }
    await audit(
      trx,
      actor,
      invoice.account_id,
      'invoice.payment',
      { number: invoice.number, status: invoice.status, paid: fromCents(before) },
      {
        number: invoice.number,
        status,
        paid: fromCents(before + amountCents),
        amount: fromCents(amountCents),
        reference: payment.reference,
      },
    );
    return { paymentId: id, status, amountDue: fromCents(due - amountCents) };
  });
}

/** Cancel an open invoice that has no payments. The row stays (status `void`) for the record. */
export async function voidInvoice(
  db: Knex,
  invoiceId: string,
  reason: string,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (trx) => {
    const invoice = await trx('subscription_invoices')
      .where({ id: invoiceId })
      .forUpdate()
      .first('id', 'account_id', 'number', 'status');
    if (!invoice) throw invoiceNotFound();
    if (invoice.status !== 'open') {
      throw new HttpError(409, 'invoice_not_open', `Invoice is ${invoice.status}`);
    }
    if (await trx('subscription_payments').where({ invoice_id: invoice.id }).first('id')) {
      throw new HttpError(409, 'invoice_has_payments', 'Invoice has payments; it cannot be voided');
    }
    await trx('subscription_invoices').where({ id: invoice.id }).update({ status: 'void' });
    await audit(
      trx,
      actor,
      invoice.account_id,
      'invoice.void',
      { number: invoice.number, status: 'open' },
      { number: invoice.number, status: 'void', reason },
    );
  });
}
