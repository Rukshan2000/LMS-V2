import { createKnex, withTenant } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision } from './provision.js';
import { addDays, colomboToday } from '../src/lib/time.js';
import { generateInvoices, recordPayment, voidInvoice } from '../src/modules/billing/service.js';

// Head-count metering by triggers (migration 014) and monthly invoices (docs/SAAS_PLAN.md §6).

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let ownerId: string;
let tenantId: string;
let accountId: string;
let api: string;

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
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
const setOverride = (key: string, value: unknown, account = accountId) =>
  ownerDb('account_overrides')
    .insert({ account_id: account, key, value: JSON.stringify(value), note: 'test' })
    .onConflict(['account_id', 'key'])
    .merge();
/** Today's metered row for one head. */
const today = async (head: string, tenant = tenantId) =>
  ownerDb('tenant_usage_daily')
    .where({ tenant_id: tenant, head })
    .whereRaw('day = ?', [colomboToday()])
    .first('count_max as max', 'count_last as last');
const addStudent = async (fullName: string, guardianPhone?: string) => {
  const res = await call('POST', '/students', {
    fullName,
    force: true,
    ...(guardianPhone && {
      guardians: [{ fullName: 'Kamala', phone: guardianPhone, relationship: 'mother' }],
    }),
  });
  expect(res.statusCode).toBe(201);
  return res.json().student.id as string;
};
const acceptInvite = (code: string, cookie: string) =>
  call('POST', `/api/v1/invites/${code}/accept`, undefined, cookie);

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
  ({ cookie: owner, userId: ownerId } = await signup('0770000001'));
  tenantId = (await call('POST', '/api/v1/tenants', { name: 'Nimal', slug: 'nimal' })).json().tenant
    .id;
  api = `/api/v1/tenants/${tenantId}`;
  accountId = (await ownerDb('tenants').where({ id: tenantId }).first('account_id')).account_id;
});

describe('metering triggers', () => {
  it('students: add, deactivate, restore and delete; max keeps the peak, last the latest', async () => {
    const a = await addStudent('Amal');
    await addStudent('Bimal');
    expect(await today('student')).toEqual({ max: 2, last: 2 });

    await call('PATCH', `/students/${a}`, { status: 'inactive' });
    expect(await today('student')).toEqual({ max: 2, last: 1 });
    await call('PATCH', `/students/${a}`, { status: 'active' });
    expect(await today('student')).toEqual({ max: 2, last: 2 });

    // Deleted as the app role, under RLS (no API route deletes students today).
    await withTenant(appDb, { tenantId }, (trx) => trx('students').where({ id: a }).del());
    expect(await today('student')).toEqual({ max: 2, last: 1 });
    // One row per tenant, head and day.
    expect(
      await ownerDb('tenant_usage_daily').where({ tenant_id: tenantId, head: 'student' }),
    ).toHaveLength(1);
  });

  it('a CSV import of 500 rows ends with one row counting 500', async () => {
    await setOverride('cap.students', null);
    const csv = ['name', ...Array.from({ length: 500 }, (_, i) => `Student ${i}`)].join('\n');
    const res = await app.inject({
      method: 'POST',
      url: `${api}/students/import?dryRun=false`,
      headers: { cookie: owner, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.created).toBe(500);
    expect(
      await ownerDb('tenant_usage_daily').where({ tenant_id: tenantId, head: 'student' }),
    ).toMatchObject([{ count_max: 500, count_last: 500 }]);
  });

  it('a teacher counts once the invite is accepted, and stops when removed', async () => {
    const invite = await call('POST', '/invites', {
      fullName: 'Sunil',
      phone: '0712345678',
      role: 'teacher',
    });
    expect((await today('teacher'))?.last ?? 0).toBe(0);
    const teacher = await signup('0712345678');
    expect((await acceptInvite(invite.json().code, teacher.cookie)).statusCode).toBe(200);
    expect(await today('teacher')).toEqual({ max: 1, last: 1 });

    const m = await ownerDb('tenant_memberships').where({ user_id: teacher.userId }).first('id');
    expect((await call('DELETE', `/members/${m.id}`)).statusCode).toBe(200);
    expect(await today('teacher')).toEqual({ max: 1, last: 0 });
  });

  it('a parent invite is not counted; accepting it is', async () => {
    const kid = await addStudent('Amal', '0722222222');
    const invite = await call('POST', `/students/${kid}/portal-invite`, { phone: '0722222222' });
    expect(invite.statusCode).toBe(201);
    expect((await today('parent'))?.max ?? 0).toBe(0);

    const mother = await signup('0722222222');
    expect((await acceptInvite(invite.json().code, mother.cookie)).statusCode).toBe(200);
    expect(await today('parent')).toEqual({ max: 1, last: 1 });
  });

  it('the owner is not a billable head; an added admin role is', async () => {
    expect(await today('admin')).toEqual({ max: 0, last: 0 });
    const membership = await ownerDb('tenant_memberships').where({ tenant_id: tenantId }).first();
    await withTenant(appDb, { tenantId }, (trx) =>
      trx('membership_roles').insert({
        tenant_id: tenantId,
        membership_id: membership.id,
        role: 'admin',
      }),
    );
    expect(await today('admin')).toEqual({ max: 1, last: 1 });
  });

  it('usage rows are isolated per institute', async () => {
    await addStudent('Amal');
    const other = await withTenant(appDb, { tenantId: crypto.randomUUID() }, (trx) =>
      trx('tenant_usage_daily'),
    );
    expect(other).toEqual([]);
  });

  it('deleting an institute still works (its rows go with it)', async () => {
    await addStudent('Amal');
    await ownerDb('tenants').where({ id: tenantId }).del();
    expect(await ownerDb('tenant_usage_daily')).toEqual([]);
  });
});

describe('monthly invoices', () => {
  // The month before the current one, so every test is a "finished month" whatever the date.
  const period = addDays(`${colomboToday().slice(0, 7)}-01`, -1).slice(0, 7);
  const day = (d: number) => `${period}-${String(d).padStart(2, '0')}`;
  const actor = () => ({ userId: ownerId });
  const usage = (tenant: string, head: string, d: string, max: number, last = max) =>
    ownerDb('tenant_usage_daily')
      .insert({ tenant_id: tenant, head, day: d, count_max: max, count_last: last })
      .onConflict(['tenant_id', 'head', 'day'])
      .merge();
  const endTrial = (at: Date, account = accountId) =>
    ownerDb('accounts').where({ id: account }).update({ trial_ends_at: at });
  const invoices = () => ownerDb('subscription_invoices').orderBy('number');
  const state = async () => (await call('GET', '')).json().entitlements.state;

  /** Trial ends during the 10th; one teacher, nothing else. */
  async function simpleMonth() {
    await endTrial(new Date(`${day(10)}T12:00:00+05:30`));
    await usage(tenantId, 'teacher', day(1), 1);
    const [invoice] = await generateInvoices(appDb, period, actor());
    return invoice!;
  }

  it('heads changing across two institutes give the expected bill, to the cent', async () => {
    await setOverride('cap.institutes', 3);
    const second = (
      await call('POST', '/api/v1/tenants', { name: 'Second', slug: 'second' })
    ).json().tenant.id;
    // Trial ends at 23:30 Sri Lanka time on the 10th: days 1–10 are free.
    await endTrial(new Date(`${day(10)}T23:30:00+05:30`));
    await setOverride('price.student', 79.99);
    await setOverride('price.parent', 12.5);
    await setOverride('included.parent', 4);

    // Students. A opens the month at 40, peaks at 120 during the trial, then 70 on the 15th.
    await usage(tenantId, 'student', addDays(day(1), -7), 40);
    await usage(tenantId, 'student', day(5), 120, 50);
    await usage(tenantId, 'student', day(15), 70, 60);
    await usage(second, 'student', day(12), 30);
    await usage(second, 'student', day(15), 45, 20);
    await usage(second, 'student', day(20), 25);
    // Account per day after the trial: 11th 50, 12th–14th 80, 15th 70+45 = 115, then ≤ 85.
    await usage(tenantId, 'teacher', day(1), 2);
    await usage(second, 'teacher', day(18), 3, 1); // 18th: 2 + 3 = 5
    await usage(tenantId, 'parent', day(28), 10);
    await usage(second, 'admin', day(2), 1);

    // Another customer still in trial all month: no invoice even with heads.
    const other = await signup('0770000002');
    const otherTenant = (
      await call('POST', '/api/v1/tenants', { name: 'Other', slug: 'other' }, other.cookie)
    ).json().tenant.id;
    await usage(otherTenant, 'student', day(3), 50);

    const generated = await generateInvoices(appDb, period, actor());
    const dueDate = addDays(colomboToday(), 7);
    expect(generated).toEqual([
      expect.objectContaining({ number: `S-${period}-0001`, total: '19273.85', dueDate }),
    ]);
    const [invoice] = await invoices();
    expect(invoice).toMatchObject({ account_id: accountId, period, status: 'open' });
    expect(invoice.lines).toEqual([
      // 115 × 79.99 = 9198.85
      {
        type: 'head',
        head: 'student',
        peak: 115,
        included: 0,
        billable: 115,
        unitPrice: '79.99',
        amount: '9198.85',
      },
      {
        type: 'head',
        head: 'teacher',
        peak: 5,
        included: 0,
        billable: 5,
        unitPrice: '2000.00',
        amount: '10000.00',
      },
      // (10 − 4 free) × 12.50
      {
        type: 'head',
        head: 'parent',
        peak: 10,
        included: 4,
        billable: 6,
        unitPrice: '12.50',
        amount: '75.00',
      },
      {
        type: 'head',
        head: 'admin',
        peak: 1,
        included: 0,
        billable: 1,
        unitPrice: '0.00',
        amount: '0.00',
      },
    ]);
    expect(await ownerDb('platform_audit')).toMatchObject([
      {
        actor_user_id: ownerId,
        account_id: accountId,
        action: 'invoice.generate',
        after: { number: `S-${period}-0001`, total: '19273.85' },
      },
    ]);
  });

  it('only finished months can be invoiced', async () => {
    const thisMonth = colomboToday().slice(0, 7);
    await expect(generateInvoices(appDb, thisMonth, actor())).rejects.toMatchObject({
      code: 'invalid_period',
    });
    await expect(generateInvoices(appDb, '2026-13', actor())).rejects.toMatchObject({
      code: 'invalid_period',
    });
  });

  it('generating twice is a no-op; a later price change does not touch the invoice', async () => {
    const first = await simpleMonth();
    expect(first.total).toBe('2000.00');
    await setOverride('price.teacher', 5000);
    expect(await generateInvoices(appDb, period, actor())).toEqual([]);
    expect(await invoices()).toMatchObject([{ number: first.number, total: '2000.00' }]);
    expect((await invoices())[0].lines[0]).toMatchObject({ unitPrice: '2000.00' });
  });

  it('two runs at once still make one invoice', async () => {
    await endTrial(new Date(`${day(10)}T12:00:00+05:30`));
    await usage(tenantId, 'teacher', day(1), 1);
    const runs = await Promise.all([1, 2, 3].map(() => generateInvoices(appDb, period, actor())));
    expect(runs.flat()).toHaveLength(1);
    expect(await invoices()).toHaveLength(1);
  });

  it('part payments add up; the same clientRef records once', async () => {
    const invoice = await simpleMonth();
    const clientRef = crypto.randomUUID();
    const pay = (amount: string, ref = clientRef) =>
      recordPayment(appDb, invoice.id, { amount, reference: 'BOC 123', clientRef: ref }, actor());

    expect(await pay('500')).toMatchObject({ status: 'open', amountDue: '1500.00' });
    expect(await pay('500')).toMatchObject({ status: 'open', amountDue: '1500.00' });
    expect(await ownerDb('subscription_payments')).toHaveLength(1);

    await expect(pay('1500.01', crypto.randomUUID())).rejects.toMatchObject({
      code: 'amount_exceeds_due',
    });
    expect(await pay('1500', crypto.randomUUID())).toMatchObject({
      status: 'paid',
      amountDue: '0.00',
    });
    expect((await invoices())[0].status).toBe('paid');
    await expect(pay('1', crypto.randomUUID())).rejects.toMatchObject({
      code: 'invoice_not_open',
    });
    expect(
      (await ownerDb('platform_audit').where({ action: 'invoice.payment' })).map((a) => a.after),
    ).toMatchObject([
      { paid: '500.00', status: 'open' },
      { paid: '2000.00', status: 'paid' },
    ]);
  });

  it('the account goes overdue, restricted, and back to active as the invoice ages and is paid', async () => {
    const invoice = await simpleMonth();
    expect(await state()).toBe('active');
    const due = (daysAgo: number) =>
      ownerDb('subscription_invoices')
        .where({ id: invoice.id })
        .update({ due_date: addDays(colomboToday(), -daysAgo) });

    await due(3);
    expect(await state()).toBe('overdue');
    await due(8);
    expect(await state()).toBe('restricted');
    await recordPayment(
      appDb,
      invoice.id,
      { amount: '1999.99', reference: 'part', clientRef: crypto.randomUUID() },
      actor(),
    );
    expect(await state()).toBe('restricted');
    await recordPayment(
      appDb,
      invoice.id,
      { amount: '0.01', reference: 'rest', clientRef: crypto.randomUUID() },
      actor(),
    );
    expect(await state()).toBe('active');
  });

  it('void: only open invoices without payments, audited', async () => {
    const invoice = await simpleMonth();
    await voidInvoice(appDb, invoice.id, 'Wrong count', actor());
    expect((await invoices())[0].status).toBe('void');
    expect(await state()).toBe('active');
    await expect(voidInvoice(appDb, invoice.id, 'again', actor())).rejects.toMatchObject({
      code: 'invoice_not_open',
    });
    await expect(
      recordPayment(
        appDb,
        invoice.id,
        { amount: '1', reference: 'x', clientRef: crypto.randomUUID() },
        actor(),
      ),
    ).rejects.toMatchObject({ code: 'invoice_not_open' });
    expect(await ownerDb('platform_audit').where({ action: 'invoice.void' })).toMatchObject([
      { before: { status: 'open' }, after: { status: 'void', reason: 'Wrong count' } },
    ]);
  });
});
