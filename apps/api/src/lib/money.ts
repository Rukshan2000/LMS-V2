import { z } from 'zod';

// LKR amounts move between PostgreSQL numeric(12,2) (strings) and integer cents in JS.
// Never use floating point for money.

/** "1234.5" → 123450. Accepts up to 10 integer digits and 2 decimals. */
export function toCents(value: string): number {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid amount: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 123450 → "1234.50" */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** API input: "1500", "1500.5", 1500 → "1500.50" string for SQL. */
export const amountInput = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = typeof v === 'number' ? String(v) : v;
  try {
    return fromCents(toCents(s));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid_amount' });
    return z.NEVER;
  }
});
