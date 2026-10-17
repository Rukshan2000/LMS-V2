// Billing service: the only code that reads accounts, price books, overrides and subscription
// invoices (docs/SAAS_PLAN.md §4 rule 3). Other modules use the functions exported by index.ts.
import type { Knex } from 'knex';
import { HttpError } from '../../lib/http-error.js';
import { fromCents, toCents } from '../../lib/money.js';
import { CAP_HEAD, CAPS, type Cap, type Feature, type Head, type Values } from './catalogue.js';
import { resolveAccountState, resolveValues, type ResolvedState } from './resolve.js';
import { countAccountHeads } from './usage.js';

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

interface AccountContext {
  account: AccountRow;
  state: ResolvedState;
  values: Values;
}

async function accountContext(trx: Knex.Transaction, account: AccountRow): Promise<AccountContext> {
  // Sequential: one transaction = one connection, which runs one query at a time anyway.
  const settings = await loadSettings(trx);
  const book = await trx('price_books').where({ key: account.price_book }).first('values');
  const overrides = await trx('account_overrides')
    .where({ account_id: account.id })
    .select('key', 'value', 'expires_at as expiresAt');
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
    values: resolveValues(book?.values ?? {}, overrides),
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
