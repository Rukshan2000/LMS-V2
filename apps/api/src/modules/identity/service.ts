import argon2 from 'argon2';
import { HttpError } from '../../lib/http-error.js';

/** Sri Lankan mobile to digits-only international form: 0771234567 / +94 77 123 4567 → 94771234567. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s\-()+]/g, '');
  if (/^0\d{9}$/.test(digits)) return `94${digits.slice(1)}`;
  if (/^94\d{9}$/.test(digits)) return digits;
  throw new HttpError(400, 'invalid_phone', 'Enter a Sri Lankan mobile number, e.g. 0771234567');
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Verify against a real hash even when the user does not exist, so response time
// does not reveal which phone numbers are registered.
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await argon2.verify(hash ?? (await dummyHash), password);
  return ok && hash !== undefined;
}
