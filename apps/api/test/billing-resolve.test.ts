import { describe, expect, it } from 'vitest';
import { valuesSchema } from '../src/modules/billing/catalogue.js';
import { resolveAccountState, resolveValues } from '../src/modules/billing/resolve.js';

// 2026-10-17 10:00 in Sri Lanka.
const now = new Date('2026-10-17T04:30:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86400_000);
const settings = { graceDays: 7 };
const none = { trialEndsAt: null, suspendedAt: null };
const invoice = (dueDate: string, amountDueCents = 100_00) => ({
  number: `S-${dueDate}`,
  dueDate,
  amountDueCents,
});

describe('resolveAccountState', () => {
  it('active when nothing is due', () => {
    expect(resolveAccountState(none, [], settings, now)).toMatchObject({
      state: 'active',
      writable: true,
      canAddHeads: true,
      daysLeft: null,
      amountDueCents: 0,
    });
  });

  it('trial while trial_ends_at is in the future, with whole days left rounded up', () => {
    const r = resolveAccountState({ ...none, trialEndsAt: days(29.5) }, [], settings, now);
    expect(r).toMatchObject({ state: 'trial', daysLeft: 30, canAddHeads: true });
    expect(resolveAccountState({ ...none, trialEndsAt: days(-1) }, [], settings, now).state).toBe(
      'active',
    );
  });

  it('open invoice not yet due is still active; after the due date it is overdue', () => {
    expect(resolveAccountState(none, [invoice('2026-10-17')], settings, now).state).toBe('active');
    const r = resolveAccountState(none, [invoice('2026-10-16')], settings, now);
    expect(r).toMatchObject({
      state: 'overdue',
      canAddHeads: true,
      overdueInvoice: 'S-2026-10-16',
    });
  });

  it('restricted after due date + grace days: no new heads, but still writable', () => {
    expect(resolveAccountState(none, [invoice('2026-10-10')], settings, now).state).toBe('overdue');
    const r = resolveAccountState(none, [invoice('2026-10-09')], settings, now);
    expect(r).toMatchObject({ state: 'restricted', writable: true, canAddHeads: false });
  });

  it('fully paid invoices do not count', () => {
    expect(resolveAccountState(none, [invoice('2026-01-01', 0)], settings, now).state).toBe(
      'active',
    );
  });

  it('first matching rule wins: suspended over trial over restricted', () => {
    const late = [invoice('2026-09-01')];
    expect(
      resolveAccountState({ trialEndsAt: days(5), suspendedAt: days(-1) }, late, settings, now),
    ).toMatchObject({ state: 'suspended', writable: false, canAddHeads: false });
    expect(resolveAccountState({ ...none, trialEndsAt: days(5) }, late, settings, now).state).toBe(
      'trial',
    );
  });

  it('sums every unpaid invoice and names the oldest overdue one', () => {
    const r = resolveAccountState(
      none,
      [invoice('2026-10-20', 50_00), invoice('2026-09-08', 70_00)],
      settings,
      now,
    );
    expect(r).toMatchObject({ amountDueCents: 120_00, overdueInvoice: 'S-2026-09-08' });
  });
});

describe('resolveValues', () => {
  const book = {
    'price.student': 100,
    'price.teacher': 2000,
    'cap.institutes': 3,
    'feature.reports': true,
  };

  it('missing keys fall back to safe defaults: free, no cap, feature off', () => {
    const v = resolveValues(book, [], now);
    expect(v.price).toMatchObject({ student: 100, teacher: 2000, parent: 0 });
    expect(v.caps).toEqual({ students: null, teachers: null, parents: null, institutes: 3 });
    expect(v.features).toMatchObject({ reports: true, bank_slips: false });
    expect(v.minimumMonthly).toBe(0);
  });

  it('account overrides win over the book until they expire', () => {
    const overrides = [
      { key: 'price.student', value: 80, expiresAt: days(10) },
      { key: 'cap.students', value: 100, expiresAt: days(-1) },
      { key: 'feature.bank_slips', value: true, expiresAt: null },
    ];
    const v = resolveValues(book, overrides, now);
    expect(v.price.student).toBe(80);
    expect(v.caps.students).toBeNull();
    expect(v.features.bank_slips).toBe(true);
  });

  it('a null cap override removes a cap from the book', () => {
    const v = resolveValues(book, [{ key: 'cap.institutes', value: null, expiresAt: null }], now);
    expect(v.caps.institutes).toBeNull();
  });

  it('ignores unknown keys and invalid values instead of failing', () => {
    const v = resolveValues(
      { ...book, 'price.unicorn': 5, 'price.parent': -5, 'cap.students': 1.5 },
      [{ key: 'feature.reports', value: 'yes', expiresAt: null }],
      now,
    );
    expect(v.price.parent).toBe(0);
    expect(v.caps.students).toBeNull();
    expect(v.features.reports).toBe(true);
  });

  it('the write schema rejects unknown keys and prices with more than 2 decimals', () => {
    expect(valuesSchema.safeParse({ 'price.student': 99.5 }).success).toBe(true);
    expect(valuesSchema.safeParse({ 'price.student': 99.555 }).success).toBe(false);
    expect(valuesSchema.safeParse({ 'price.unicorn': 1 }).success).toBe(false);
  });
});
