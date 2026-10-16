import { describe, expect, it } from 'vitest';
import { pickLocale } from './config';

describe('pickLocale', () => {
  it('uses the saved cookie first', () => {
    expect(pickLocale('ta', 'en-US,en;q=0.9')).toBe('ta');
  });
  it('ignores an invalid cookie and follows the browser', () => {
    expect(pickLocale('fr', 'en-US,en;q=0.9')).toBe('en');
    expect(pickLocale(undefined, 'si-LK,si;q=0.9,en;q=0.8')).toBe('si');
  });
  it('skips unsupported browser languages', () => {
    expect(pickLocale(undefined, 'fr-FR,ta;q=0.5')).toBe('ta');
  });
  it('falls back to Sinhala', () => {
    expect(pickLocale(undefined, null)).toBe('si');
    expect(pickLocale(undefined, 'fr,de')).toBe('si');
  });
});
