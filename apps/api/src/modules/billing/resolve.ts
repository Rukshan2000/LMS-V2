// Pure rules (no I/O): what state an account is in, and which values apply to it.
// docs/SAAS_PLAN.md §5.2 and §7.2. Most billing tests target this file.
import { addDays, colomboToday } from '../../lib/time.js';
import {
  CAPS,
  FEATURES,
  HEADS,
  defaults,
  keyValue,
  type Cap,
  type Feature,
  type Head,
  type Values,
} from './catalogue.js';

export type AccountState = 'suspended' | 'trial' | 'restricted' | 'overdue' | 'active';

export interface AccountFacts {
  trialEndsAt: Date | null;
  suspendedAt: Date | null;
}
export interface OpenInvoice {
  number: string;
  /** YYYY-MM-DD, Sri Lanka date. */
  dueDate: string;
  amountDueCents: number;
}

export interface ResolvedState {
  state: AccountState;
  /** False only when suspended: then every write is refused. */
  writable: boolean;
  /** False when suspended or restricted: no new students, teachers or parents. */
  canAddHeads: boolean;
  trialEndsAt: Date | null;
  /** Whole days left in the trial (rounded up), or null outside a trial. */
  daysLeft: number | null;
  amountDueCents: number;
  /** Oldest unpaid invoice past its due date, for messages. */
  overdueInvoice: string | null;
  /** Its due date (YYYY-MM-DD), for the overdue banner. */
  overdueDueDate: string | null;
}

/** First matching rule wins: suspended → trial → restricted → overdue → active. */
export function resolveAccountState(
  account: AccountFacts,
  openInvoices: OpenInvoice[],
  settings: { graceDays: number },
  now = new Date(),
): ResolvedState {
  const today = colomboToday(now);
  const unpaid = openInvoices
    .filter((i) => i.amountDueCents > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = unpaid.filter((i) => today > i.dueDate);
  const restricted = overdue.filter((i) => today > addDays(i.dueDate, settings.graceDays));
  const inTrial = account.trialEndsAt !== null && account.trialEndsAt > now;

  const state: AccountState = account.suspendedAt
    ? 'suspended'
    : inTrial
      ? 'trial'
      : restricted.length
        ? 'restricted'
        : overdue.length
          ? 'overdue'
          : 'active';

  return {
    state,
    writable: state !== 'suspended',
    canAddHeads: state !== 'suspended' && state !== 'restricted',
    trialEndsAt: account.trialEndsAt,
    daysLeft: inTrial
      ? Math.ceil((account.trialEndsAt!.getTime() - now.getTime()) / 86400_000)
      : null,
    amountDueCents: unpaid.reduce((sum, i) => sum + i.amountDueCents, 0),
    overdueInvoice: overdue[0]?.number ?? null,
    overdueDueDate: overdue[0]?.dueDate ?? null,
  };
}

export interface Override {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

/**
 * Catalogue defaults, then the price book, then unexpired account overrides (override wins).
 * Unknown or invalid keys are ignored, so stale data can never break a request.
 */
export function resolveValues(
  book: Record<string, unknown>,
  overrides: Override[],
  now = new Date(),
): Values {
  const values = defaults();
  const apply = (key: string, raw: unknown) => {
    let value: unknown;
    try {
      const parsed = keyValue(key).safeParse(raw);
      if (!parsed.success) return;
      value = parsed.data;
    } catch {
      return; // unknown key
    }
    const [kind, name] = key.split('.') as [string, string];
    if (kind === 'price' && HEADS.includes(name as Head))
      values.price[name as Head] = value as number;
    else if (kind === 'included' && HEADS.includes(name as Head))
      values.included[name as Head] = value as number;
    else if (key === 'minimum.monthly') values.minimumMonthly = value as number;
    else if (kind === 'cap' && CAPS.includes(name as Cap))
      values.caps[name as Cap] = value as number | null;
    else if (kind === 'feature' && FEATURES.includes(name as Feature))
      values.features[name as Feature] = value as boolean;
  };
  for (const [key, raw] of Object.entries(book)) apply(key, raw);
  for (const o of overrides) if (!o.expiresAt || o.expiresAt > now) apply(o.key, o.value);
  return values;
}
