// Pure invoice calculation (no I/O), docs/SAAS_PLAN.md §6.2. Money is integer cents.
import { fromCents } from '../../lib/money.js';
import { addDays, colomboToday } from '../../lib/time.js';
import { HEADS, type Head, type Values } from './catalogue.js';

/** One tenant_usage_daily row. `day` is a Sri Lanka date, YYYY-MM-DD. */
export interface UsageRow {
  tenantId: string;
  head: Head;
  day: string;
  countMax: number;
  countLast: number;
}

export type InvoiceLine =
  | {
      type: 'head';
      head: Head;
      peak: number;
      included: number;
      billable: number;
      unitPrice: string;
      amount: string;
    }
  | { type: 'minimum'; minimum: string; amount: string };

export interface ComputedInvoice {
  lines: InvoiceLine[];
  total: string;
  totalCents: number;
}

/** Every date of a YYYY-MM month. */
export function monthDays(period: string): string[] {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => addDays(`${period}-01`, i));
}

// Catalogue money has at most 2 decimals, so this is exact.
const cents = (lkr: number) => Math.round(lkr * 100);

/**
 * Each head's total across institutes for each of `days`. `rows` holds each institute's rows in
 * the range plus its last row before it (the opening count). A day without a row carries the
 * institute's previous count_last forward.
 */
export function dailyTotals(rows: UsageRow[], days: string[]): Record<Head, number[]> {
  const daily = Object.fromEntries(HEADS.map((h) => [h, days.map(() => 0)])) as Record<
    Head,
    number[]
  >;
  const series = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const key = `${r.tenantId}|${r.head}`;
    series.set(key, [...(series.get(key) ?? []), r]);
  }
  for (const rs of series.values()) {
    rs.sort((a, b) => a.day.localeCompare(b.day));
    const totals = daily[rs[0]!.head];
    let last = 0;
    let i = 0;
    days.forEach((day, d) => {
      while (i < rs.length && rs[i]!.day < day) last = rs[i++]!.countLast;
      totals[d]! += rs[i]?.day === day ? rs[i]!.countMax : last;
    });
  }
  return daily;
}

/**
 * The bill for one account and month, or null when every billed day was a trial day. With
 * `lastDay`, only days up to it count: the month so far, for estimates (SAAS_PLAN §6.4), so an
 * estimate and the invoice come from the same rules.
 */
export function computeInvoice(
  rows: UsageRow[],
  values: Values,
  trialEndsAt: Date | null,
  period: string,
  lastDay?: string,
): ComputedInvoice | null {
  const days = monthDays(period).filter((d) => !lastDay || d <= lastDay);
  // Days on or before the trial's last (Sri Lanka) day are free.
  const trialEnd = trialEndsAt ? colomboToday(trialEndsAt) : '';
  if (!days.some((d) => d > trialEnd)) return null;
  const daily = dailyTotals(rows, days);

  const lines: InvoiceLine[] = [];
  let totalCents = 0;
  for (const head of HEADS) {
    const peak = Math.max(0, ...days.map((d, i) => (d > trialEnd ? daily[head][i]! : 0)));
    if (peak === 0) continue;
    const included = values.included[head];
    const billable = Math.max(0, peak - included);
    const amount = billable * cents(values.price[head]);
    totalCents += amount;
    lines.push({
      type: 'head',
      head,
      peak,
      included,
      billable,
      unitPrice: fromCents(cents(values.price[head])),
      amount: fromCents(amount),
    });
  }
  const minimum = cents(values.minimumMonthly);
  if (totalCents < minimum) {
    lines.push({
      type: 'minimum',
      minimum: fromCents(minimum),
      amount: fromCents(minimum - totalCents),
    });
    totalCents = minimum;
  }
  return { lines, total: fromCents(totalCents), totalCents };
}
