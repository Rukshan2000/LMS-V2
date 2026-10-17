import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Knex } from 'knex';
import { HttpError } from '../../lib/http-error.js';
import type { OtpPurpose } from '../../lib/mail-templates.js';

// 6-digit email codes (docs/EMAIL_AUTH_PLAN.md §4). Only a hash is stored; it covers the
// purpose and email, so a code for one cannot be used for another.

export const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const PER_HOUR = 5;

const hashCode = (purpose: OtpPurpose, email: string, code: string) =>
  createHash('sha256').update(`${purpose}:${email}:${code}`).digest('hex');

/** New code for this email + purpose (older ones die). Throws 429 when asked too often. */
export async function issueOtp(
  db: Knex,
  { email, purpose, userId }: { email: string; purpose: OtpPurpose; userId?: string },
): Promise<string> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`otp:${email}`]);
    const recent: { purpose: string; created_at: Date }[] = await trx('email_otps')
      .where({ email })
      .where('created_at', '>', new Date(Date.now() - 3600_000))
      .orderBy('created_at', 'desc')
      .select('purpose', 'created_at');
    const last = recent.find((r) => r.purpose === purpose);
    if (last && last.created_at.getTime() > Date.now() - RESEND_SECONDS * 1000) {
      throw new HttpError(429, 'otp_too_soon', 'Wait a minute before asking for a new code');
    }
    if (recent.length >= PER_HOUR) {
      throw new HttpError(429, 'otp_limit', 'Too many codes for this email. Try again later');
    }
    await trx('email_otps')
      .where({ email, purpose })
      .whereNull('consumed_at')
      .update({ consumed_at: trx.fn.now() });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await trx('email_otps').insert({
      email,
      purpose,
      user_id: userId ?? null,
      code_hash: hashCode(purpose, email, code),
      expires_at: new Date(Date.now() + OTP_MINUTES * 60_000),
    });
    return code;
  });
}

/** Uses up the code, or throws 400 otp_invalid (wrong, expired, used, or too many tries). */
export async function consumeOtp(
  db: Knex,
  {
    email,
    purpose,
    code,
    userId,
  }: { email: string; purpose: OtpPurpose; code: string; userId?: string },
): Promise<void> {
  // Committed even when the code is wrong, so failed attempts count.
  const ok = await db.transaction(async (trx) => {
    const row = await trx('email_otps')
      .where({ email, purpose })
      .modify((q) => {
        if (userId) q.where({ user_id: userId });
      })
      .whereNull('consumed_at')
      .where('expires_at', '>', trx.fn.now())
      .where('attempts', '<', MAX_ATTEMPTS)
      .orderBy('created_at', 'desc')
      .forUpdate()
      .first('id', 'code_hash');
    if (!row) return false;
    const match =
      /^\d{6}$/.test(code) &&
      timingSafeEqual(
        Buffer.from(row.code_hash, 'hex'),
        Buffer.from(hashCode(purpose, email, code), 'hex'),
      );
    await trx('email_otps')
      .where({ id: row.id })
      .update(match ? { consumed_at: trx.fn.now() } : { attempts: trx.raw('attempts + 1') });
    return match;
  });
  if (!ok) throw new HttpError(400, 'otp_invalid', 'Wrong or expired code');
}
