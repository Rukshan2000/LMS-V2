import { describe, expect, it } from 'vitest';
import { amountInput, fromCents, toCents } from '../src/lib/money.js';

describe('money', () => {
  it('converts between strings and integer cents without floating point', () => {
    expect(toCents('1500')).toBe(150000);
    expect(toCents('1500.5')).toBe(150050);
    expect(toCents('0.05')).toBe(5);
    expect(toCents('9999999999.99')).toBe(999999999999);
    expect(fromCents(150050)).toBe('1500.50');
    expect(fromCents(5)).toBe('0.05');
    // 0.1 + 0.2 style errors cannot happen:
    expect(fromCents(toCents('0.10') + toCents('0.20'))).toBe('0.30');
  });

  it('rejects bad amounts', () => {
    for (const bad of ['-1', '1.234', 'abc', '', '1e5', '12345678901']) {
      expect(() => toCents(bad)).toThrow();
    }
    expect(amountInput.safeParse('1.999').success).toBe(false);
    expect(amountInput.parse(2500)).toBe('2500.00');
    expect(amountInput.parse('2500.5')).toBe('2500.50');
  });
});
