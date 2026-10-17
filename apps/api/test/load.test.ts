import { createKnex } from '@lms/db';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateInvoices, listAccounts } from '../src/modules/billing/service.js';
import { addDays, colomboToday } from '../src/lib/time.js';
import { monthDays } from '../src/modules/billing/invoice.js';

// Load check (docs/SAAS_PLAN.md §11 Phase 5): 300 accounts, console list under 1 s, invoice
// generation for a month under 10 s. Slow to seed, so only on demand:
//   LOAD_CHECK=1 npx vitest run test/load.test.ts   (in apps/api)

const ACCOUNTS = 300;
const thisMonth = colomboToday().slice(0, 7);
const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);

let appDb: Knex;
let ownerDb: Knex;
let adminId: string;

describe.skipIf(!process.env.LOAD_CHECK)('load check', () => {
  beforeAll(async () => {
    appDb = createKnex(process.env.TEST_DATABASE_URL!);
    ownerDb = createKnex(process.env.TEST_MIGRATION_DATABASE_URL!);
    await ownerDb.raw('TRUNCATE tenants, users, accounts CASCADE');
    const n = Array.from({ length: ACCOUNTS }, (_, i) => i);
    const users = await ownerDb('users')
      .insert(
        n.map((i) => ({
          phone: `9477${String(i).padStart(7, '0')}`,
          full_name: `Owner ${i}`,
          password_hash: 'x',
        })),
      )
      .returning('id');
    adminId = users[0].id;
    // Trials ended long ago, so last month and this month are billed.
    const accounts = await ownerDb('accounts')
      .insert(
        n.map((i) => ({
          name: `Account ${i}`,
          owner_user_id: users[i].id,
          owner_phone: `9477${String(i).padStart(7, '0')}`,
          price_book: 'standard',
          trial_ends_at: new Date('2020-01-01'),
        })),
      )
      .returning('id');
    const tenants = await ownerDb('tenants')
      .insert(n.map((i) => ({ name: `T ${i}`, slug: `load-${i}`, account_id: accounts[i].id })))
      .returning('id');
    // A change every few days, for every head, over last month and this month so far.
    const days = [...monthDays(lastMonth), ...monthDays(thisMonth)].filter(
      (d, i) => i % 3 === 0 && d <= colomboToday(),
    );
    const heads = ['student', 'teacher', 'parent', 'admin', 'receptionist'];
    const rows = tenants.flatMap((t: { id: string }, i: number) =>
      days.flatMap((day, d) =>
        heads.map((head, h) => {
          const count = ((i + d) % 50) + (h === 0 ? 100 : h);
          return { tenant_id: t.id, head, day, count_max: count, count_last: count };
        }),
      ),
    );
    for (let i = 0; i < rows.length; i += 5000) {
      await ownerDb('tenant_usage_daily').insert(rows.slice(i, i + 5000));
    }
  }, 120_000);

  afterAll(async () => {
    await ownerDb.raw('TRUNCATE tenants, users, accounts CASCADE');
    await Promise.all([appDb.destroy(), ownerDb.destroy()]);
  });

  const timed = async <T>(work: () => Promise<T>) => {
    const start = performance.now();
    const result = await work();
    return { result, ms: Math.round(performance.now() - start) };
  };

  it(`console accounts list for ${ACCOUNTS} accounts: under 1 s`, async () => {
    const { result, ms } = await timed(() => listAccounts(appDb, {}));
    console.log(`listAccounts: ${result.length} accounts in ${ms} ms`);
    expect(result).toHaveLength(ACCOUNTS);
    expect(ms).toBeLessThan(1000);
  });

  it(`invoice generation for ${ACCOUNTS} accounts: under 10 s`, async () => {
    const { result, ms } = await timed(() =>
      generateInvoices(appDb, lastMonth, { userId: adminId }),
    );
    console.log(`generateInvoices: ${result.length} invoices in ${ms} ms`);
    expect(result).toHaveLength(ACCOUNTS);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});
