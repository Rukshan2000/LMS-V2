import type { Knex } from 'knex';
import { loadSettings, openAccount } from '../src/modules/billing/service.js';
import { normalizePhone } from '../src/lib/phone.js';

/** What the platform console does before a customer can create institutes: a trial account. */
export const provision = (db: Knex, phone: string, name = phone) =>
  db.transaction(async (trx) => {
    const book = await trx('price_books').where({ is_default: true }).first('key');
    const { trialDays } = await loadSettings(trx);
    return openAccount(trx, {
      name,
      ownerPhone: normalizePhone(phone),
      priceBook: book.key,
      trialEndsAt: new Date(Date.now() + trialDays * 86400_000),
    });
  });
