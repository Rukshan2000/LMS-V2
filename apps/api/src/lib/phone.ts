import { HttpError } from './http-error.js';

/** Sri Lankan mobile → digits-only international form, or null if not one. 0771234567 / +94 77 123 4567 → 94771234567. */
export function parsePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()+]/g, '');
  if (/^0\d{9}$/.test(digits)) return `94${digits.slice(1)}`;
  if (/^94\d{9}$/.test(digits)) return digits;
  return null;
}

export function normalizePhone(input: string): string {
  const phone = parsePhone(input);
  if (!phone) {
    throw new HttpError(400, 'invalid_phone', 'Enter a Sri Lankan mobile number, e.g. 0771234567');
  }
  return phone;
}
