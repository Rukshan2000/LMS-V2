import { describe, expect, it } from 'vitest';
import { defaults, type Head, type Values } from '../src/modules/billing/catalogue.js';
import { computeInvoice, monthDays, type UsageRow } from '../src/modules/billing/invoice.js';

// Pure invoice calculation (docs/SAAS_PLAN.md §6.2).

const values = (patch: (v: Values) => void = () => {}): Values => {
  const v = defaults();
  v.price = { student: 100, teacher: 2000, parent: 50, admin: 0, receptionist: 0 };
  patch(v);
  return v;
};
const row = (
  tenantId: string,
  head: Head,
  day: string,
  countMax: number,
  countLast = countMax,
): UsageRow => ({ tenantId, head, day, countMax, countLast });
const line = (head: Head, peak: number, unitPrice: string, amount: string, included = 0) => ({
  type: 'head',
  head,
  peak,
  included,
  billable: peak - included,
  unitPrice,
  amount,
});

describe('monthDays', () => {
  it('lists every day, including leap years', () => {
    expect(monthDays('2026-09')).toHaveLength(30);
    expect(monthDays('2028-02').at(-1)).toBe('2028-02-29');
    expect(monthDays('2026-12')[0]).toBe('2026-12-01');
  });
});

describe('computeInvoice', () => {
  it('sums institutes per day, then takes the peak day', () => {
    // A peaks on the 5th, B on the 20th: the bill is the busiest day for the account as a whole.
    const rows = [
      row('A', 'student', '2026-09-01', 50),
      row('A', 'student', '2026-09-05', 80),
      row('A', 'student', '2026-09-10', 40),
      row('B', 'student', '2026-09-01', 30),
      row('B', 'student', '2026-09-20', 70),
    ];
    // Day 5: 80 + 30 = 110. Day 20: 40 + 70 = 110. Day 10: 40 + 30 = 70.
    const invoice = computeInvoice(rows, values(), null, '2026-09');
    expect(invoice).toEqual({
      lines: [line('student', 110, '100.00', '11000.00')],
      total: '11000.00',
      totalCents: 1_100_000,
    });
  });

  it("carries a day's last count forward and uses the day's max on the day itself", () => {
    // Up to 60 during the 3rd, back to 45 by the end of it; 45 holds until the 4th's row.
    const rows = [row('A', 'teacher', '2026-09-03', 6, 4), row('B', 'teacher', '2026-09-04', 3)];
    // Day 3: 6 + 0. Day 4: 4 + 3 = 7.
    expect(computeInvoice(rows, values(), null, '2026-09')!.lines).toEqual([
      line('teacher', 7, '2000.00', '14000.00'),
    ]);
  });

  it('opens the month with the last count from before it', () => {
    const rows = [
      row('A', 'student', '2026-07-15', 90, 25), // older row: ignored, the later one wins
      row('A', 'student', '2026-08-20', 30, 20),
      row('A', 'student', '2026-09-10', 15, 10),
    ];
    expect(computeInvoice(rows, values(), null, '2026-09')!.lines[0]).toMatchObject({ peak: 20 });
  });

  it('excludes days on or before the trial end (Sri Lanka date)', () => {
    const rows = [row('A', 'student', '2026-09-01', 100), row('A', 'student', '2026-09-13', 40)];
    // 2026-09-12 23:00 in Colombo is still the 12th: the 12th is free, the 13th is billed.
    const trialEnd = new Date('2026-09-12T17:30:00Z');
    expect(computeInvoice(rows, values(), trialEnd, '2026-09')!.lines[0]).toMatchObject({
      peak: 40,
    });
    // Ending at 00:30 Colombo on the 13th makes the 13th free too; the 40 carried into the 14th
    // is billed.
    const later = new Date('2026-09-12T19:00:00Z');
    expect(computeInvoice(rows, values(), later, '2026-09')!.lines[0]).toMatchObject({
      peak: 40,
    });
  });

  it('a trial covering the whole month bills nothing at all', () => {
    const rows = [row('A', 'student', '2026-09-01', 100)];
    expect(computeInvoice(rows, values(), new Date('2026-10-05T00:00:00Z'), '2026-09')).toBeNull();
    // Ending on the month's last day is still the whole month.
    expect(computeInvoice(rows, values(), new Date('2026-09-30T12:00:00Z'), '2026-09')).toBeNull();
  });

  it('subtracts the free allowance and never goes below zero', () => {
    const rows = [row('A', 'student', '2026-09-01', 120), row('A', 'parent', '2026-09-01', 5)];
    const v = values((v) => {
      v.included.student = 100;
      v.included.parent = 10;
    });
    expect(computeInvoice(rows, v, null, '2026-09')).toMatchObject({
      lines: [
        line('student', 120, '100.00', '2000.00', 100),
        { head: 'parent', peak: 5, included: 10, billable: 0, amount: '0.00' },
      ],
      total: '2000.00',
    });
  });

  it('tops up to the minimum charge with its own line', () => {
    const rows = [row('A', 'student', '2026-09-01', 10)];
    const v = values((v) => (v.minimumMonthly = 2500));
    expect(computeInvoice(rows, v, null, '2026-09')).toEqual({
      lines: [
        line('student', 10, '100.00', '1000.00'),
        { type: 'minimum', minimum: '2500.00', amount: '1500.00' },
      ],
      total: '2500.00',
      totalCents: 250_000,
    });
    // Above the minimum: no top-up line.
    const big = [row('A', 'student', '2026-09-01', 30)];
    expect(computeInvoice(big, v, null, '2026-09')!.lines).toHaveLength(1);
  });

  it('an account with no heads owes nothing (or just the minimum)', () => {
    expect(computeInvoice([], values(), null, '2026-09')).toEqual({
      lines: [],
      total: '0.00',
      totalCents: 0,
    });
    const v = values((v) => (v.minimumMonthly = 1000));
    expect(computeInvoice([], v, null, '2026-09')!.total).toBe('1000.00');
  });

  it('keeps cents exact (no floating point)', () => {
    // 0.1 + 0.2 style prices: 3 × 33.33 + 7 × 0.07 = 99.99 + 0.49 = 100.48
    const v = values((v) => {
      v.price.student = 33.33;
      v.price.parent = 0.07;
    });
    const rows = [row('A', 'student', '2026-09-01', 3), row('A', 'parent', '2026-09-01', 7)];
    expect(computeInvoice(rows, v, null, '2026-09')).toMatchObject({
      lines: [
        { head: 'student', unitPrice: '33.33', amount: '99.99' },
        { head: 'parent', unitPrice: '0.07', amount: '0.49' },
      ],
      total: '100.48',
      totalCents: 10_048,
    });
  });

  it('lists heads at price 0 (admins) so the bill shows them', () => {
    const rows = [row('A', 'admin', '2026-09-01', 2)];
    expect(computeInvoice(rows, values(), null, '2026-09')!.lines).toEqual([
      line('admin', 2, '0.00', '0.00'),
    ]);
  });

  it('month so far: days after lastDay do not count (estimate = same rules as the bill)', () => {
    const rows = [row('A', 'student', '2026-09-01', 10), row('A', 'student', '2026-09-20', 90)];
    expect(computeInvoice(rows, values(), null, '2026-09', '2026-09-19')!.lines).toEqual([
      line('student', 10, '100.00', '1000.00'),
    ]);
    expect(computeInvoice(rows, values(), null, '2026-09', '2026-09-20')!.total).toBe('9000.00');
    // Still in trial on the last counted day: nothing billed yet.
    const trialEnd = new Date('2026-09-25T00:00:00Z');
    expect(computeInvoice(rows, values(), trialEnd, '2026-09', '2026-09-20')).toBeNull();
  });
});
