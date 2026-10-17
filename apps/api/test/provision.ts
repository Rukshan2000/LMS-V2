import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import type { Mail } from '../src/lib/mail.js';
import { normalizePhone } from '../src/lib/phone.js';
import { loadSettings, openAccount } from '../src/modules/billing/service.js';

/** The test email of the user with this phone. */
export const emailFor = (phone: string) => `${normalizePhone(phone)}@test.lk`;

/** What the platform console does before a customer can create institutes: a trial account. */
export const provision = (db: Knex, phone: string, name = phone) =>
  db.transaction(async (trx) => {
    const book = await trx('price_books').where({ is_default: true }).first('key');
    const { trialDays } = await loadSettings(trx);
    return openAccount(trx, {
      name,
      ownerEmail: emailFor(phone),
      ownerPhone: normalizePhone(phone),
      priceBook: book.key,
      trialEndsAt: new Date(Date.now() + trialDays * 86400_000),
    });
  });

/** Mail the app sent (buildApp's default in-memory mailer), newest last. */
export const sentMail = (app: FastifyInstance) => (app.mailer as unknown as { sent: Mail[] }).sent;

/** The 6-digit code in the newest mail to this address. */
export const lastCode = (app: FastifyInstance, email: string) =>
  [...sentMail(app)]
    .reverse()
    .find((m) => m.to === email)
    ?.text.match(/^\d{6}$/m)?.[0] ?? '';

/** Sign up the way a person does: email → code from the mail → details. Returns the last response. */
export async function signupUser(
  app: FastifyInstance,
  {
    phone,
    fullName = 'Test User',
    password = 'correct-horse',
    email = emailFor(phone!),
  }: { phone?: string; fullName?: string; password?: string; email?: string },
) {
  const start = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup/start',
    payload: { email },
  });
  if (start.statusCode !== 202) return start;
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup/verify',
    payload: { email, code: lastCode(app, email), phone, password, fullName, acceptPrivacy: true },
  });
}
