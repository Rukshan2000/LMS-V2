import { describe, expect, it } from 'vitest';
import { cents, fmtMoney } from './money';

describe('money formatting', () => {
  it('adds thousands separators and two decimals', () => {
    expect(fmtMoney('2500.00')).toBe('2,500.00');
    expect(fmtMoney('1234567.5')).toBe('1,234,567.50');
    expect(fmtMoney('0')).toBe('0.00');
    expect(fmtMoney(null)).toBe('0.00');
  });
  it('converts to integer cents', () => {
    expect(cents('2500.50')).toBe(250050);
    expect(cents('0.1') + cents('0.2')).toBe(30);
  });
});
