// Billing service: the only code that reads accounts, price books, overrides and subscription
// invoices (docs/SAAS_PLAN.md §4 rule 3). Other modules use the functions exported by index.ts.
import { forEachTenant } from '@lms/db';
import type { Knex } from 'knex';
import { HttpError } from '../../lib/http-error.js';
import { fromCents, toCents } from '../../lib/money.js';
import { addDays, colomboToday } from '../../lib/time.js';
import { z } from 'zod';
import {
  CAP_HEAD,
  CAPS,
  HEADS,
  KEYS,
  keyValue,
  valuesSchema,
  type Cap,
  type Feature,
  type Head,
  type Values,
} from './catalogue.js';
import { computeInvoice, dailyTotals, monthDays } from './invoice.js';
import {
  resolveAccountState,
  resolveValues,
  type AccountState,
  type ResolvedState,
} from './resolve.js';
import { accountTenantIds, countAccountHeads, usageRows } from './usage.js';

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

export const accountSuspended = () =>
  new HttpError(403, 'account_suspended', 'This account is suspended. Contact support.');
export const featureLocked = (feature: Feature) =>
  new HttpError(403, 'feature_locked', 'This feature is not included in your plan', { feature });

function assertWritable({ state }: AccountContext) {
  if (!state.writable) throw accountSuspended();
}

/** Refuse any write while the account is suspended (e.g. a family member joining). */
export async function assertAccountWritable(trx: Knex.Transaction, tenantId: string) {
  assertWritable(await contextForTenant(trx, tenantId));
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
  if (!ctx.values.features[feature]) throw featureLocked(feature);
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
    overdueInvoice: state.overdueInvoice,
    overdueDueDate: state.overdueDueDate,
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
  accountId: string | null,
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

function assertFinishedPeriod(period: string, now: Date) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period >= colomboToday(now).slice(0, 7)) {
    throw new HttpError(400, 'invalid_period', 'Only a finished month (YYYY-MM) can be invoiced');
  }
}

/** The account's live (not void) invoice for a month, if any. */
const liveInvoice = (trx: Knex.Transaction, accountId: string, period: string) =>
  trx('subscription_invoices')
    .where({ account_id: accountId, period })
    .whereNot({ status: 'void' })
    .first('id');

/** What the account would be billed for a finished month, with prices as they are now. */
async function computeForPeriod(
  trx: Knex.Transaction,
  accountId: string,
  period: string,
  now: Date,
) {
  const account = await trx('accounts')
    .where({ id: accountId })
    .first('id', 'price_book', 'trial_ends_at');
  const days = monthDays(period);
  const rows = await usageRows(trx, accountId, days[0]!, days.at(-1)!);
  return computeInvoice(
    rows,
    await accountValues(trx, account, now),
    account.trial_ends_at,
    period,
  );
}

export interface GeneratedInvoice {
  id: string;
  accountId: string;
  number: string;
  total: string;
  dueDate: string;
}

/**
 * One invoice per account for a finished month. Idempotent: an account that already has a live
 * invoice for the period is skipped (and a unique index on live invoices backs that up), so running
 * it twice does nothing. Accounts with nothing to bill (trial all month, total 0) get no invoice.
 * Each account has its own transaction, so one failure does not undo the others.
 */
export async function generateInvoices(
  db: Knex,
  period: string,
  actor: Actor,
  now = new Date(),
): Promise<GeneratedInvoice[]> {
  assertFinishedPeriod(period, now);
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
  // A voided invoice does not count: the month can be generated again (SAAS_PLAN §8.1).
  if (await liveInvoice(trx, accountId, period)) return null;
  // Prices as they are now; the invoice keeps them, later changes never touch it.
  const computed = await computeForPeriod(trx, accountId, period, now);
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

/** Totals per head for a finished month, without creating anything (Generate shows these first). */
export async function previewInvoices(
  db: Knex,
  period: string,
  now = new Date(),
): Promise<{ accountId: string; accountName: string; total: string }[]> {
  assertFinishedPeriod(period, now);
  return db.transaction(async (trx) => {
    const accounts: { id: string; name: string }[] = await trx('accounts')
      .orderBy('created_at')
      .select('id', 'name');
    const preview = [];
    for (const a of accounts) {
      if (await liveInvoice(trx, a.id, period)) continue;
      const computed = await computeForPeriod(trx, a.id, period, now);
      if (computed && computed.totalCents > 0) {
        preview.push({ accountId: a.id, accountName: a.name, total: computed.total });
      }
    }
    return preview;
  });
}

// ---- Platform console (docs/SAAS_PLAN.md §10). Metadata only: names, owner phone, counts,
// prices and money; never students, guardians, attendance or fee records.

const accountNotFound = () => new HttpError(404, 'not_found', 'Account not found');

const ACCOUNT_COLUMNS = [
  'a.id',
  'a.name',
  'a.owner_phone',
  'a.owner_user_id',
  'u.full_name as owner_name',
  'a.price_book',
  'a.trial_ends_at',
  'a.suspended_at',
  'a.suspended_reason',
  'a.notes',
  'a.created_at',
];
type AccountDetailRow = AccountRow & {
  name: string;
  owner_phone: string;
  owner_user_id: string | null;
  owner_name: string | null;
  suspended_reason: string | null;
  notes: string | null;
  created_at: Date;
};
const accountsQuery = (trx: Knex.Transaction) =>
  trx('accounts as a').leftJoin('users as u', 'u.id', 'a.owner_user_id').select(ACCOUNT_COLUMNS);

/**
 * This month so far, from tenant_usage_daily: heads per day, heads now (latest count) and the
 * estimate, which uses computeInvoice with the same rules as the bill (SAAS_PLAN §6.4).
 */
async function monthSoFar(trx: Knex.Transaction, ctx: AccountContext, now: Date) {
  const today = colomboToday(now);
  const period = today.slice(0, 7);
  const rows = await usageRows(trx, ctx.account.id, `${period}-01`, today);
  const days = monthDays(period).filter((d) => d <= today);
  const daily = dailyTotals(rows, days);
  // Tomorrow has no rows yet, so each institute carries its latest count_last into it.
  const latest = dailyTotals(rows, [addDays(today, 1)]);
  const estimate = computeInvoice(rows, ctx.values, ctx.account.trial_ends_at, period, today);
  return {
    period,
    days: days.map((day, i) => ({
      day,
      ...Object.fromEntries(HEADS.map((h) => [h, daily[h][i]!])),
    })),
    headsNow: Object.fromEntries(HEADS.map((h) => [h, latest[h][0]!])) as Record<Head, number>,
    estimate: estimate ?? { lines: [], total: '0.00', totalCents: 0 },
  };
}

function summary(row: AccountDetailRow, ctx: AccountContext) {
  return {
    id: row.id,
    name: row.name,
    ownerPhone: row.owner_phone,
    ownerName: row.owner_name,
    claimed: row.owner_user_id !== null,
    priceBook: row.price_book,
    trialEndsAt: row.trial_ends_at,
    suspendedAt: row.suspended_at,
    state: ctx.state.state,
    daysLeft: ctx.state.daysLeft,
    amountDue: fromCents(ctx.state.amountDueCents),
    overdueInvoice: ctx.state.overdueInvoice,
    createdAt: row.created_at,
  };
}

export type AccountFilter = AccountState | 'trial_ending';

/** Accounts list: state, heads now, this month's estimate and amount due. */
export async function listAccounts(
  db: Knex,
  { q, state }: { q?: string; state?: AccountFilter },
  now = new Date(),
) {
  return db.transaction(async (trx) => {
    const query = accountsQuery(trx).orderBy('a.name');
    if (q) {
      // 0771234567 is stored as 94771234567: match without the leading 0.
      const digits = q.replace(/\D/g, '').replace(/^0/, '');
      query.where((w) => {
        w.whereILike('a.name', `%${q}%`);
        if (digits.length >= 3) w.orWhere('a.owner_phone', 'like', `%${digits}%`);
      });
    }
    const rows: AccountDetailRow[] = await query;
    // ponytail: a few queries per account, sequential on one transaction. Fine for hundreds of
    // accounts; add a monthly rollup table if the list gets slow (SAAS_TASKS Phase 3).
    const list = [];
    for (const row of rows) {
      const ctx = await accountContext(trx, row);
      const s = ctx.state;
      const keep =
        !state ||
        (state === 'trial_ending'
          ? s.state === 'trial' && (s.daysLeft ?? 0) <= 7
          : s.state === state);
      if (!keep) continue;
      const month = await monthSoFar(trx, ctx, now);
      list.push({
        ...summary(row, ctx),
        institutes: (await accountTenantIds(trx, row.id)).length,
        headsNow: month.headsNow,
        estimate: month.estimate.total,
      });
    }
    return list;
  });
}

const invoiceColumns = (trx: Knex.Transaction) => [
  'i.id',
  'i.account_id as accountId',
  'i.number',
  'i.period',
  'i.lines',
  'i.total',
  'i.status',
  trx.raw(`to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate"`),
  'i.created_at as createdAt',
  trx.raw(
    `(SELECT COALESCE(sum(p.amount), 0)::numeric(12, 2)::text FROM subscription_payments p WHERE p.invoice_id = i.id) AS paid`,
  ),
];

/** Everything about one account the console shows. */
export async function getAccount(db: Knex, accountId: string, now = new Date()) {
  return db.transaction(async (trx) => {
    const row: AccountDetailRow | undefined = await accountsQuery(trx)
      .where('a.id', accountId)
      .first();
    if (!row) throw accountNotFound();
    const ctx = await accountContext(trx, row);
    const book = await trx('price_books')
      .where({ key: row.price_book })
      .first('key', 'name', 'values');
    const overrides = await trx('account_overrides as o')
      .leftJoin('users as u', 'u.id', 'o.created_by')
      .where('o.account_id', accountId)
      .orderBy('o.key')
      .select(
        'o.key',
        'o.value',
        'o.expires_at as expiresAt',
        'o.note',
        'o.created_at as createdAt',
        'u.full_name as createdBy',
      );
    const institutes = await trx('tenants')
      .where({ account_id: accountId })
      .orderBy('created_at')
      .select('id', 'name', 'slug', 'status', 'created_at as createdAt');
    const invoices = await trx('subscription_invoices as i')
      .where('i.account_id', accountId)
      .orderBy('i.period', 'desc')
      .orderBy('i.created_at', 'desc')
      .select(invoiceColumns(trx));
    const payments = await trx('subscription_payments as p')
      .join('subscription_invoices as i', 'i.id', 'p.invoice_id')
      .where('i.account_id', accountId)
      .orderBy('p.received_at', 'desc')
      .select(
        'p.id',
        'i.number',
        'p.amount',
        'p.method',
        'p.reference',
        'p.received_at as receivedAt',
      );
    const month = await monthSoFar(trx, ctx, now);
    return {
      account: { ...summary(row, ctx), notes: row.notes, suspendedReason: row.suspended_reason },
      values: ctx.values,
      book,
      overrides,
      institutes,
      invoices,
      payments,
      month,
      audit: await auditQuery(trx, { accountId, limit: 100 }),
    };
  });
}

/**
 * The customer's Billing page (owner, admin): prices, this month so far (the console's
 * monthSoFar, so the estimate and the bill come from the same computeInvoice), invoices and where
 * to pay. Void invoices are left out: they were replaced or cancelled.
 */
export async function getBilling(trx: Knex.Transaction, tenantId: string, now = new Date()) {
  const ctx = await contextForTenant(trx, tenantId);
  const month = await monthSoFar(trx, ctx, now);
  const invoices = await trx('subscription_invoices as i')
    .where('i.account_id', ctx.account.id)
    .whereNot('i.status', 'void')
    .orderBy('i.period', 'desc')
    .orderBy('i.created_at', 'desc')
    .limit(24)
    .select(invoiceColumns(trx).filter((c) => c !== 'i.account_id as accountId'));
  const settings = await trx('platform_settings')
    .whereIn('key', ['bank_details', 'support_whatsapp'])
    .select('key', 'value');
  const setting = (key: string) => settings.find((s) => s.key === key)?.value ?? null;
  const money = (lkr: number) => fromCents(Math.round(lkr * 100));
  return {
    prices: Object.fromEntries(HEADS.map((h) => [h, money(ctx.values.price[h])])) as Record<
      Head,
      string
    >,
    included: ctx.values.included,
    minimumMonthly: money(ctx.values.minimumMonthly),
    thisMonth: {
      period: month.period,
      headsNow: month.headsNow,
      lines: month.estimate.lines,
      total: month.estimate.total,
    },
    invoices,
    // bank_details is free text (SAAS_PLAN §10.2), shown as written.
    payTo: {
      bankDetails: setting('bank_details') as string | null,
      whatsapp: setting('support_whatsapp') as string | null,
    },
  };
}

/** One account row, locked, or 404. */
async function lockAccount(trx: Knex.Transaction, accountId: string) {
  const account = await trx('accounts')
    .where({ id: accountId })
    .forUpdate()
    .first(
      'id',
      'name',
      'notes',
      'price_book',
      'trial_ends_at',
      'suspended_at',
      'suspended_reason',
    );
  if (!account) throw accountNotFound();
  return account;
}

async function assertPriceBook(trx: Knex.Transaction, key: string) {
  if (!(await trx('price_books').where({ key }).first('key'))) {
    throw new HttpError(400, 'unknown_price_book', `No price book ${key}`);
  }
}

/**
 * An account created by the platform admin for a customer who has not signed up yet. The
 * customer claims it by creating an institute with this phone (SAAS_PLAN §10.3). No trial caps:
 * the admin picks the price book, and sets caps as overrides if wanted.
 */
export async function createAccount(
  db: Knex,
  input: { name: string; ownerPhone: string; priceBook: string; trialDays: number },
  actor: Actor,
  now = new Date(),
) {
  return db.transaction(async (trx) => {
    await lock(trx, `account-phone:${input.ownerPhone}`);
    await assertPriceBook(trx, input.priceBook);
    // A second account for the same phone could never be claimed (claiming takes the oldest).
    const owner = await trx('users').where({ phone: input.ownerPhone }).first('id');
    const existing = await trx('accounts')
      .where({ owner_phone: input.ownerPhone })
      .modify((w) => {
        if (owner) w.orWhere({ owner_user_id: owner.id });
      })
      .first('id');
    if (existing) {
      throw new HttpError(409, 'account_exists', 'This phone already has an account', {
        accountId: existing.id,
      });
    }
    const trialEndsAt =
      input.trialDays > 0 ? new Date(now.getTime() + input.trialDays * 86400_000) : null;
    const [account] = await trx('accounts')
      .insert({
        name: input.name,
        owner_phone: input.ownerPhone,
        price_book: input.priceBook,
        trial_ends_at: trialEndsAt,
        created_by: actor.userId,
      })
      .returning(['id', 'name', 'owner_phone', 'price_book', 'trial_ends_at']);
    await audit(trx, actor, account.id, 'account.create', null, {
      name: account.name,
      ownerPhone: account.owner_phone,
      priceBook: account.price_book,
      trialEndsAt: account.trial_ends_at,
    });
    return { id: account.id as string, ownerPhone: account.owner_phone as string };
  });
}

export async function updateAccount(
  db: Knex,
  accountId: string,
  patch: { name?: string; notes?: string | null; priceBook?: string },
  actor: Actor,
) {
  await db.transaction(async (trx) => {
    const account = await lockAccount(trx, accountId);
    if (patch.priceBook !== undefined) await assertPriceBook(trx, patch.priceBook);
    const before = { name: account.name, notes: account.notes, priceBook: account.price_book };
    const after = { ...before, ...patch };
    await trx('accounts').where({ id: accountId }).update({
      name: after.name,
      notes: after.notes,
      price_book: after.priceBook,
      updated_at: trx.fn.now(),
    });
    await audit(trx, actor, accountId, 'account.update', before, after);
  });
}

const overrideRow = (trx: Knex.Transaction, accountId: string, key: string) =>
  trx('account_overrides')
    .where({ account_id: accountId, key })
    .first('value', 'expires_at as expiresAt', 'note');

/** A per-customer value for one catalogue key; wins over the price book until it expires. */
export async function setOverride(
  db: Knex,
  accountId: string,
  key: string,
  input: { value: unknown; expiresAt: Date | null; note: string },
  actor: Actor,
  now = new Date(),
) {
  if (!KEYS.includes(key)) throw new HttpError(400, 'unknown_key', `Unknown billing key: ${key}`);
  const value = keyValue(key).parse(input.value);
  if (input.expiresAt && input.expiresAt <= now) {
    throw new HttpError(400, 'expiry_in_past', 'The expiry must be in the future');
  }
  await db.transaction(async (trx) => {
    await lockAccount(trx, accountId);
    const before = (await overrideRow(trx, accountId, key)) ?? null;
    const row = {
      account_id: accountId,
      key,
      value: JSON.stringify(value),
      expires_at: input.expiresAt,
      note: input.note,
      created_by: actor.userId,
      created_at: trx.fn.now(),
    };
    await trx('account_overrides').insert(row).onConflict(['account_id', 'key']).merge();
    await audit(trx, actor, accountId, 'override.set', before && { key, ...before }, {
      key,
      value,
      expiresAt: input.expiresAt,
      note: input.note,
    });
  });
}

export async function clearOverride(db: Knex, accountId: string, key: string, actor: Actor) {
  await db.transaction(async (trx) => {
    await lockAccount(trx, accountId);
    const before = await overrideRow(trx, accountId, key);
    if (!before) throw new HttpError(404, 'not_found', 'No override for this key');
    await trx('account_overrides').where({ account_id: accountId, key }).del();
    await audit(trx, actor, accountId, 'override.clear', { key, ...before }, { key });
  });
}

/**
 * Extend a running trial by `days`, or start a new one from now. Overrides that expired with the
 * running trial (the trial caps) move with it.
 */
export async function extendTrial(
  db: Knex,
  accountId: string,
  days: number,
  actor: Actor,
  now = new Date(),
) {
  return db.transaction(async (trx) => {
    const account = await lockAccount(trx, accountId);
    const running: Date | null =
      account.trial_ends_at && account.trial_ends_at > now ? account.trial_ends_at : null;
    const trialEndsAt = new Date((running ?? now).getTime() + days * 86400_000);
    await trx('accounts')
      .where({ id: accountId })
      .update({ trial_ends_at: trialEndsAt, updated_at: trx.fn.now() });
    const moved = running
      ? await trx('account_overrides')
          .where({ account_id: accountId, expires_at: running })
          .update({ expires_at: trialEndsAt })
      : 0;
    await audit(
      trx,
      actor,
      accountId,
      'account.trial',
      { trialEndsAt: account.trial_ends_at },
      { trialEndsAt, days, overridesMoved: moved },
    );
    return { trialEndsAt };
  });
}

/**
 * Rewrite today's tenant_usage_daily rows from live counts, for every institute of the account
 * (SAAS_PLAN §13: a path the triggers missed). Uses the triggers' own meter_tenant(), so the day's
 * peak never goes down: count_max = GREATEST(count_max, now), count_last = now.
 */
export async function recountUsage(db: Knex, accountId: string, actor: Actor, now = new Date()) {
  return db.transaction(async (trx) => {
    await lockAccount(trx, accountId);
    const today = colomboToday(now);
    const ids = await accountTenantIds(trx, accountId);
    const before = dailyTotals(await usageRows(trx, accountId, today, today), [today]);
    await forEachTenant(trx, ids, (id) => trx.raw('SELECT meter_tenant(?)', [id]));
    const after = dailyTotals(await usageRows(trx, accountId, today, today), [today]);
    const day = (t: Record<Head, number[]>) =>
      Object.fromEntries(HEADS.map((h) => [h, t[h][0]!])) as Record<Head, number>;
    await audit(
      trx,
      actor,
      accountId,
      'account.recount',
      { day: today, ...day(before) },
      {
        day: today,
        ...day(after),
      },
    );
    return { day: today, counts: day(after) };
  });
}

/** Read-only for the customer (SAAS_PLAN §5.2 rule 1). */
export async function suspendAccount(db: Knex, accountId: string, reason: string, actor: Actor) {
  await db.transaction(async (trx) => {
    const account = await lockAccount(trx, accountId);
    if (account.suspended_at) throw new HttpError(409, 'already_suspended', 'Already suspended');
    const [after] = await trx('accounts')
      .where({ id: accountId })
      .update({ suspended_at: trx.fn.now(), suspended_reason: reason, updated_at: trx.fn.now() })
      .returning(['suspended_at as suspendedAt', 'suspended_reason as reason']);
    await audit(trx, actor, accountId, 'account.suspend', { suspendedAt: null }, after);
  });
}

export async function unsuspendAccount(db: Knex, accountId: string, actor: Actor) {
  await db.transaction(async (trx) => {
    const account = await lockAccount(trx, accountId);
    if (!account.suspended_at) throw new HttpError(409, 'not_suspended', 'Not suspended');
    await trx('accounts')
      .where({ id: accountId })
      .update({ suspended_at: null, suspended_reason: null, updated_at: trx.fn.now() });
    await audit(
      trx,
      actor,
      accountId,
      'account.unsuspend',
      { suspendedAt: account.suspended_at, reason: account.suspended_reason },
      { suspendedAt: null },
    );
  });
}

export async function listInvoices(
  db: Knex,
  { period, status }: { period?: string; status?: string },
) {
  return db.transaction((trx) =>
    trx('subscription_invoices as i')
      .join('accounts as a', 'a.id', 'i.account_id')
      .modify((w) => {
        if (period) w.where('i.period', period);
        if (status) w.where('i.status', status);
      })
      .orderBy('i.number', 'desc')
      // ponytail: newest 500 without a period filter; add paging when there are more.
      .limit(500)
      .select([...invoiceColumns(trx), 'a.name as accountName', 'a.owner_phone as ownerPhone']),
  );
}

// ---- Price books and settings: platform-wide, audited with no account.

export async function listPriceBooks(db: Knex) {
  return db('price_books as b')
    .orderBy([{ column: 'b.is_default', order: 'desc' }, 'b.key'])
    .select(
      'b.key',
      'b.name',
      'b.values',
      'b.is_default as isDefault',
      'b.updated_at as updatedAt',
      db.raw('(SELECT count(*)::int FROM accounts a WHERE a.price_book = b.key) AS accounts'),
    );
}

/** Replace a book's values. Unknown keys are refused (valuesSchema is strict). */
export async function updatePriceBook(
  db: Knex,
  key: string,
  input: { name?: string; values: unknown },
  actor: Actor,
) {
  const values = valuesSchema.parse(input.values);
  return db.transaction(async (trx) => {
    const book = await trx('price_books').where({ key }).forUpdate().first('name', 'values');
    if (!book) throw new HttpError(404, 'not_found', 'Price book not found');
    const name = input.name ?? book.name;
    await trx('price_books')
      .where({ key })
      .update({ name, values: JSON.stringify(values), updated_at: trx.fn.now() });
    await audit(trx, actor, null, 'price_book.update', { key, ...book }, { key, name, values });
    const affected = await trx('accounts').where({ price_book: key }).count({ n: '*' }).first();
    return { affectedAccounts: Number(affected?.n ?? 0) };
  });
}

export async function createPriceBook(
  db: Knex,
  input: { key: string; name: string; values: unknown },
  actor: Actor,
) {
  const values = valuesSchema.parse(input.values);
  await db.transaction(async (trx) => {
    if (await trx('price_books').where({ key: input.key }).first('key')) {
      throw new HttpError(409, 'price_book_exists', 'A price book with this key exists');
    }
    await trx('price_books').insert({
      key: input.key,
      name: input.name,
      values: JSON.stringify(values),
    });
    await audit(trx, actor, null, 'price_book.create', null, { ...input, values });
  });
}

/** Each setting the console may change, with its schema (SAAS_PLAN §5.3). */
const SETTINGS_SCHEMA: Record<string, z.ZodType> = {
  trial_days: z.number().int().min(1).max(365),
  grace_days: z.number().int().min(0).max(90),
  invoice_due_days: z.number().int().min(0).max(90),
  trial_caps: valuesSchema.refine(
    (v) => Object.keys(v).every((k) => k.startsWith('cap.')),
    'only cap.* keys',
  ),
  // wa.me format, like users.phone.
  support_whatsapp: z
    .string()
    .regex(/^94\d{9}$/)
    .nullable(),
  bank_details: z.string().trim().min(1).max(1000).nullable(),
};

export async function getSettings(db: Knex): Promise<Record<string, unknown>> {
  const rows: { key: string; value: unknown }[] = await db('platform_settings').select(
    'key',
    'value',
  );
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(Object.keys(SETTINGS_SCHEMA).map((k) => [k, stored[k] ?? null]));
}

export async function updateSetting(db: Knex, key: string, raw: unknown, actor: Actor) {
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) throw new HttpError(404, 'not_found', 'Unknown setting');
  const value = schema.parse(raw);
  await db.transaction(async (trx) => {
    const before = await trx('platform_settings').where({ key }).forUpdate().first('value');
    await trx('platform_settings')
      .insert({ key, value: JSON.stringify(value), updated_at: trx.fn.now() })
      .onConflict('key')
      .merge();
    await audit(
      trx,
      actor,
      null,
      'setting.update',
      { key, value: before?.value ?? null },
      {
        key,
        value,
      },
    );
  });
}

function auditQuery(
  trx: Knex | Knex.Transaction,
  { accountId, actorId, limit = 200 }: { accountId?: string; actorId?: string; limit?: number },
) {
  return (
    trx('platform_audit as e')
      .join('users as u', 'u.id', 'e.actor_user_id')
      .leftJoin('accounts as a', 'a.id', 'e.account_id')
      .modify((w) => {
        if (accountId) w.where('e.account_id', accountId);
        if (actorId) w.where('e.actor_user_id', actorId);
      })
      .orderBy('e.id', 'desc')
      // ponytail: newest `limit` rows, no paging; add a `before` cursor when the log grows.
      .limit(limit)
      .select(
        'e.id',
        'e.action',
        'e.before',
        'e.after',
        'e.ip',
        'e.created_at as createdAt',
        'e.account_id as accountId',
        'a.name as accountName',
        'u.full_name as actor',
      )
  );
}

export const listAudit = (db: Knex, filter: { accountId?: string; actorId?: string }) =>
  auditQuery(db, filter);
