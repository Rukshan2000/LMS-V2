import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision, signupUser } from './provision.js';

// Accounts, trial caps and account state (docs/SAAS_PLAN.md §5, §7). Replaces plans.test.ts.

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let accountId: string;
let api: string;

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName: `User ${phone}` });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
const createInstitute = (slug: string, cookie = owner) =>
  call('POST', '/api/v1/tenants', { name: slug, slug }, cookie);
const addStudent = (fullName: string, base = api) => call('POST', `${base}/students`, { fullName });
/** Fill a tenant with `n` active students directly in the DB (fast). */
const seedStudents = (n: number, tenant = tenantId) =>
  ownerDb('students').insert(
    Array.from({ length: n }, (_, i) => ({
      tenant_id: tenant,
      student_number: String(9000 + i),
      full_name: `Seed ${i}`,
    })),
  );
const setOverride = (key: string, value: unknown, expiresAt: Date | null = null) =>
  ownerDb('account_overrides')
    .insert({
      account_id: accountId,
      key,
      value: JSON.stringify(value),
      expires_at: expiresAt,
      note: 'test',
    })
    .onConflict(['account_id', 'key'])
    .merge();
const entitlements = async (cookie = owner) =>
  (await call('GET', '', undefined, cookie)).json().entitlements;

beforeAll(async () => {
  appDb = createKnex(process.env.TEST_DATABASE_URL!);
  ownerDb = createKnex(process.env.TEST_MIGRATION_DATABASE_URL!);
  app = await buildApp({ db: appDb, secureCookies: false, authRateLimitMax: 1000, logger: false });
});
afterAll(async () => {
  await app.close();
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

beforeEach(async () => {
  await ownerDb.raw('TRUNCATE tenants, users, accounts CASCADE');
  owner = (await signup('0770000001')).cookie;
  tenantId = (await createInstitute('nimal-maths')).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  accountId = (await ownerDb('tenants').where({ id: tenantId }).first('account_id')).account_id;
});

describe('account and trial', () => {
  it('the first institute goes into the provisioned account with a 30-day capped trial', async () => {
    const account = await ownerDb('accounts').where({ id: accountId }).first();
    expect(account).toMatchObject({ price_book: 'standard', owner_phone: '94770000001' });
    expect(await entitlements()).toMatchObject({
      state: 'trial',
      daysLeft: 30,
      writable: true,
      canAddHeads: true,
      features: { reports: true, portal: true },
      caps: {
        students: { limit: 100, used: 0 },
        teachers: { limit: 5, used: 0 },
        institutes: { limit: 1, used: 1 },
      },
    });
  });

  it('the trial cap blocks the 101st student without touching data', async () => {
    await seedStudents(99);
    expect((await addStudent('Hundredth')).statusCode).toBe(201);
    const res = await addStudent('Over');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'plan_limit',
      details: { key: 'cap.students', limit: 100, used: 100 },
    });
    expect(
      await ownerDb('students').where({ tenant_id: tenantId }).count({ n: '*' }).first(),
    ).toEqual({ n: '100' });
  });

  it('inactive students do not count, but re-activating one is checked', async () => {
    await seedStudents(100);
    const one = await ownerDb('students').where({ tenant_id: tenantId }).first('id');
    await call('PATCH', `/students/${one.id}`, { status: 'inactive' });
    const added = await addStudent('New');
    expect(added.statusCode).toBe(201);
    expect((await call('PATCH', `/students/${one.id}`, { status: 'active' })).statusCode).toBe(403);
    // Editing an active student at the cap is fine.
    const edit = await call('PATCH', `/students/${added.json().student.id}`, { grade: '2027 A/L' });
    expect(edit.statusCode).toBe(200);
  });

  it('a CSV import that would go over the cap is refused as a whole', async () => {
    await seedStudents(99);
    const res = await app.inject({
      method: 'POST',
      url: `${api}/students/import?dryRun=false`,
      headers: { cookie: owner, 'content-type': 'text/csv' },
      payload: 'name,phone\nKasun,0771111111\nNimal,0772222222\n',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().result).toMatchObject({
      created: 0,
      errors: [{ code: 'plan_limit', message: '99/100' }],
    });
  });

  it('trial caps expire with the trial; the standard price book has no student cap', async () => {
    await seedStudents(100);
    await ownerDb('account_overrides')
      .where({ account_id: accountId })
      .update({ expires_at: new Date(Date.now() - 1000) });
    await ownerDb('accounts')
      .where({ id: accountId })
      .update({ trial_ends_at: new Date(Date.now() - 1000) });
    expect((await addStudent('After trial')).statusCode).toBe(201);
    expect(await entitlements()).toMatchObject({
      state: 'active',
      daysLeft: null,
      caps: { students: { limit: null, used: 101 }, institutes: { limit: 3, used: 1 } },
    });
  });

  it('two desks adding the last place at once: only one succeeds', async () => {
    await seedStudents(99);
    const results = await Promise.all(['A', 'B', 'C'].map((n) => addStudent(n)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403, 403]);
  });
});

describe('account with several institutes', () => {
  it('the trial allows one institute; more need the cap raised', async () => {
    const refused = await createInstitute('second');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      code: 'plan_limit',
      details: { key: 'cap.institutes' },
    });
    expect(await ownerDb('tenants').count({ n: '*' }).first()).toEqual({ n: '1' });

    await setOverride('cap.institutes', 3);
    const second = await createInstitute('second');
    expect(second.statusCode).toBe(201);
    const secondAccount = await ownerDb('tenants')
      .where({ id: second.json().tenant.id })
      .first('account_id');
    expect(secondAccount.account_id).toBe(accountId);
  });

  it('caps are shared across the institutes of one account', async () => {
    await setOverride('cap.institutes', 3);
    const secondId = (await createInstitute('second')).json().tenant.id;
    await seedStudents(60);
    await seedStudents(40, secondId);
    const res = await addStudent('One too many', `/api/v1/tenants/${secondId}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().details).toMatchObject({ limit: 100, used: 100 });
    expect((await entitlements()).caps.students).toEqual({ limit: 100, used: 100 });
  });

  it('another owner gets a separate account', async () => {
    const other = (await signup('0770000002')).cookie;
    const res = await createInstitute('other-place', other);
    expect(res.statusCode).toBe(201);
    const row = await ownerDb('tenants').where({ id: res.json().tenant.id }).first('account_id');
    expect(row.account_id).not.toBe(accountId);
  });

  it('without an account from the platform console, no institute can be created', async () => {
    const other = (await signup('0770000002')).cookie;
    await ownerDb('accounts').where({ owner_phone: '94770000002' }).del();
    const res = await createInstitute('other-place', other);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('no_account');
    expect(await ownerDb('tenants').count({ n: '*' }).first()).toEqual({ n: '1' });
  });
});

describe('account claimed by phone', () => {
  it('an account the platform admin created is claimed when that phone creates an institute', async () => {
    const [created] = await ownerDb('accounts')
      .insert({ name: 'Kamal Institute', owner_phone: '94770000003', price_book: 'standard' })
      .returning('id');
    const kamal = (await signup('0770000003')).cookie;
    const res = await createInstitute('kamal', kamal);
    expect(res.statusCode).toBe(201);
    const row = await ownerDb('tenants').where({ id: res.json().tenant.id }).first('account_id');
    expect(row.account_id).toBe(created.id);
    const claimed = await ownerDb('accounts').where({ id: created.id }).first();
    expect(claimed.owner_user_id).not.toBeNull();
    expect(await ownerDb('account_overrides').where({ account_id: created.id })).toEqual([]);
  });
});

describe('account state', () => {
  const endTrial = () =>
    ownerDb('accounts')
      .where({ id: accountId })
      .update({ trial_ends_at: new Date(Date.now() - 1000) });
  const openInvoice = (dueDaysAgo: number, total = '5000.00') =>
    ownerDb('subscription_invoices').insert({
      account_id: accountId,
      number: `S-TEST-${dueDaysAgo}`,
      period: '2026-09',
      lines: JSON.stringify([]),
      total,
      due_date: new Date(Date.now() - dueDaysAgo * 86400_000).toISOString().slice(0, 10),
    });

  it('overdue still allows new students; after the grace period they are refused', async () => {
    await endTrial();
    await openInvoice(3);
    expect((await entitlements()).state).toBe('overdue');
    expect((await addStudent('While overdue')).statusCode).toBe(201);

    await ownerDb('subscription_invoices').update({
      due_date: new Date(Date.now() - 10 * 86400_000),
    });
    const res = await addStudent('While restricted');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'account_restricted',
      details: { amountDue: '5000.00', invoiceNumber: 'S-TEST-3' },
    });
    expect(await entitlements()).toMatchObject({
      state: 'restricted',
      canAddHeads: false,
      writable: true,
    });
  });

  it('restricted accounts can still edit students (nothing that exists is blocked)', async () => {
    const id = (await addStudent('Existing')).json().student.id;
    await endTrial();
    await openInvoice(30);
    expect((await call('PATCH', `/students/${id}`, { grade: '2027 A/L' })).statusCode).toBe(200);
  });

  it('a payment that covers the invoice makes the account active again', async () => {
    await endTrial();
    await openInvoice(30);
    const invoice = await ownerDb('subscription_invoices').first('id');
    await ownerDb('subscription_payments').insert({
      invoice_id: invoice.id,
      amount: '5000.00',
      client_ref: crypto.randomUUID(),
    });
    expect((await entitlements()).state).toBe('active');
    expect((await addStudent('Paid up')).statusCode).toBe(201);
  });

  it('suspended accounts cannot add students', async () => {
    await ownerDb('accounts').where({ id: accountId }).update({ suspended_at: new Date() });
    const res = await addStudent('Suspended');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('account_suspended');
  });

  it('staff without account access get limits but no head counts', async () => {
    const teacher = await signup('0770000009');
    const [m] = await ownerDb('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: teacher.userId })
      .returning('id');
    await ownerDb('membership_roles').insert({
      tenant_id: tenantId,
      membership_id: m.id,
      role: 'teacher',
    });
    const e = await entitlements(teacher.cookie);
    expect(e.caps.students).toEqual({ limit: 100 });
    // The owner sees the teacher counted.
    expect((await entitlements()).caps.teachers).toEqual({ limit: 5, used: 1 });
  });
});
