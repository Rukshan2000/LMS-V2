import { describe, expect, it } from 'vitest';
import en from '@/i18n/dictionaries/en';
import si from '@/i18n/dictionaries/si';
import {
  addDays,
  colomboDate,
  colomboTime,
  fmtDay,
  mondayOf,
  toIso,
  weekdayName,
} from './datetime';

describe('datetime (Asia/Colombo)', () => {
  it('converts UTC to Sri Lanka date and time across midnight', () => {
    expect(colomboDate('2030-01-04T19:00:00Z')).toBe('2030-01-05');
    expect(colomboTime('2030-01-05T08:30:00Z')).toBe('14:00');
  });
  it('finds the Monday of a week and adds days across months', () => {
    expect(mondayOf('2030-01-05')).toBe('2029-12-31');
    expect(mondayOf('2029-12-31')).toBe('2029-12-31');
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
  });
  it('builds ISO strings with the +05:30 offset and names weekdays', () => {
    expect(new Date(toIso('2030-01-05', '14:00')).toISOString()).toBe('2030-01-05T08:30:00.000Z');
    expect(weekdayName(1, en.calendar)).toBe('Monday');
    expect(weekdayName(7, en.calendar)).toBe('Sunday');
  });
  it('formats the Sri Lanka day in each language', () => {
    // 19:00 UTC on Friday is already Saturday in Sri Lanka.
    expect(fmtDay('2026-10-16T19:00:00Z', en.calendar)).toBe('Saturday 17 Oct');
    expect(fmtDay('2026-10-16T19:00:00Z', si.calendar)).toBe('සෙනසුරාදා 17 ඔක්');
  });
});
