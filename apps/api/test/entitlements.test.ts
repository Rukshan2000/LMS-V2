import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision } from './provision.js';
import { generateInvoices } from '../src/modules/billing/service.js';
import { addDays, colomboToday } from '../src/lib/time.js';

// Feature gates, trial, restricted and suspended accounts, staff/parent caps and the customer
// Billing page (docs/SAAS_PLAN.md §5.2, §6.4, §7.3).

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let ownerId: string;
let tenantId: string;
let accountId: string;
let api: string;
let kid: string;
let batchId: string;

const ZOOM = 'https://zoom.us/j/123';
const png = (seed = 'a') =>
  `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(seed)]).toString('base64')}`;

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
const setOverride = (key: string, value: unknown) =>
  ownerDb('account_overrides')
    .insert({ account_id: accountId, key, value: JSON.stringify(value), note: 'test' })
    .onConflict(['account_id', 'key'])
    .merge();
const feature = (name: string, on: boolean) => setOverride(`feature.${name}`, on);
const endTrial = (at = new Date(Date.now() - 1000)) =>
  ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: at });
const openInvoice = (dueDaysAgo: number) =>
  ownerDb('subscription_invoices').insert({
    account_id: accountId,
    number: `S-TEST-${dueDaysAgo}`,
    period: '2000-01',
    lines: JSON.stringify([]),
    total: '5000.00',
    due_date: addDays(colomboToday(), -dueDaysAgo),
  });
const suspend = () =>
  ownerDb('accounts').where({ id: accountId }).update({ suspended_at: new Date() });
const inviteStaff = (phone: string, role = 'teacher') =>
  call('POST', '/invites', { fullName: `Staff ${phone}`, phone, role });
const portalInvite = (phone: string, studentId = kid) =>
  call('POST', `/students/${studentId}/portal-invite`, { phone });
const accept = (code: string, cookie: string) =>
  call('POST', `/api/v1/invites/${code}/accept`, undefined, cookie);
const uploadSlip = (cookie: string) =>
  call(
    'POST',
    '/portal/slips',
    { studentId: kid, amount: '2500', file: png(), clientRef: crypto.randomUUID() },
    cookie,
  );
const importCsv = () =>
  app.inject({
    method: 'POST',
    url: `${api}/students/import?dryRun=true`,
    headers: { cookie: owner, 'content-type': 'text/csv' },
    payload: 'name,phone\nKasun,0771111111\n',
  });
/** A member with these roles, added directly (fast; metering triggers still fire). */
async function member(phone: string, role: string, tenant = tenantId) {
  const user = await signup(phone);
  const [m] = await ownerDb('tenant_memberships')
    .insert({ tenant_id: tenant, user_id: user.userId })
    .returning('id');
  await ownerDb('membership_roles').insert({ tenant_id: tenant, membership_id: m.id, role });
  return user;
}
/** The mother (guardian of `kid`) with portal access. */
async function mother() {
  const user = await signup('0722222222');
  const code = (await portalInvite('0722222222')).json().code;
  expect((await accept(code, user.cookie)).statusCode).toBe(200);
  return user.cookie;
}
const expectError = (
  res: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) => {
  expect({ status: res.statusCode, code: (res.json() as { code?: string }).code }).toEqual({
    status,
    code,
  });
};

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
  tenantId = (
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  accountId = (await ownerDb('tenants').where({ id: tenantId }).first('account_id')).account_id;
  kid = (
    await call('POST', '/students', {
      fullName: 'Amal',
      guardians: [{ fullName: 'Kamala', phone: '0722222222', relationship: 'mother' }],
      force: true,
    })
  ).json().student.id;
  batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json().batch
    .id;
  await call('PUT', `/batches/${batchId}/fees`, { class: '2500' });
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [kid] });
});

describe('feature gates (on by default, off per account)', () => {
  it('reports', async () => {
    expect((await call('GET', '/reports/summary')).statusCode).toBe(200);
    expect((await call('GET', '/reports/students.csv')).statusCode).toBe(200);
    await feature('reports', false);
    const res = await call('GET', '/reports/summary');
    expectError(res, 403, 'feature_locked');
    expect(res.json().details).toEqual({ feature: 'reports' });
    expectError(await call('GET', '/reports/payments.csv'), 403, 'feature_locked');
  });

  it('student import (adding one student by hand still works)', async () => {
    expect((await importCsv()).statusCode).toBe(200);
    await feature('student_import', false);
    expectError(await importCsv(), 403, 'feature_locked');
    expect((await call('POST', '/students', { fullName: 'By hand' })).statusCode).toBe(201);
  });

  it('bank slips: family upload and the desk queue', async () => {
    const mum = await mother();
    const slip = await uploadSlip(mum);
    expect(slip.statusCode).toBe(201);
    expect((await call('GET', '/slips')).statusCode).toBe(200);

    await feature('bank_slips', false);
    expectError(await uploadSlip(mum), 403, 'feature_locked');
    expectError(await call('GET', '/slips'), 403, 'feature_locked');
    expectError(await call('POST', `/slips/${slip.json().id}/verify`, {}), 403, 'feature_locked');
    // The pending slip is kept as it was, and comes back when the feature is on again.
    await feature('bank_slips', true);
    expect((await call('GET', '/slips')).json().slips).toHaveLength(1);
  });

  it('live links: setting a link is refused, clearing one is not', async () => {
    expect((await call('PATCH', `/batches/${batchId}`, { liveUrl: ZOOM })).statusCode).toBe(200);
    await feature('live_links', false);
    expectError(
      await call('PATCH', `/batches/${batchId}`, { liveUrl: ZOOM }),
      403,
      'feature_locked',
    );
    expectError(
      await call('POST', '/batches', { name: 'Online', subjectName: 'Maths', liveUrl: ZOOM }),
      403,
      'feature_locked',
    );
    expect(
      (await call('POST', '/batches', { name: 'Hall', subjectName: 'Maths' })).statusCode,
    ).toBe(201);
    expect((await call('PATCH', `/batches/${batchId}`, { liveUrl: null })).statusCode).toBe(200);
  });

  it('the portal hides liveUrl when live links are off', async () => {
    // Free class (no fee this month), starting in 10 minutes: the link is shown.
    const live = (
      await call('POST', '/batches', { name: 'Live', subjectName: 'Maths', liveUrl: ZOOM })
    ).json().batch.id;
    await call('POST', `/batches/${live}/enrollments`, { studentIds: [kid] });
    await call('POST', `/batches/${live}/sessions`, {
      startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    });
    const mum = await mother();
    const session = async () =>
      (await call('GET', '/portal', undefined, mum))
        .json()
        .children[0].sessions.find((s: { batchName: string }) => s.batchName === 'Live');
    expect(await session()).toMatchObject({ online: true, liveUrl: ZOOM });
    await feature('live_links', false);
    expect(await session()).toMatchObject({ online: false, liveUrl: null });
    // Stored, not deleted: staff still see it.
    expect((await call('GET', `/batches/${live}`)).json().batch.liveUrl).toBe(ZOOM);
  });

  it('portal: new invites are refused, families already in keep their access', async () => {
    const mum = await mother();
    const pending = (await portalInvite('0722222222')).json().code;
    await feature('portal', false);
    expectError(await portalInvite('0722222222'), 403, 'feature_locked');
    // An invite sent before the switch can no longer be used.
    expectError(await accept(pending, mum), 403, 'feature_locked');
    expect((await call('GET', '/portal', undefined, mum)).statusCode).toBe(200);
  });
});

describe('trial', () => {
  it('trial caps: the 6th teacher is refused at invite', async () => {
    for (const n of [1, 2, 3, 4, 5]) await member(`077100000${n}`, 'teacher');
    const res = await inviteStaff('0771000006');
    expectError(res, 403, 'plan_limit');
    expect(res.json().details).toEqual({ key: 'cap.teachers', limit: 5, used: 5 });
    // Admins and receptionists have no cap.
    expect((await inviteStaff('0771000007', 'receptionist')).statusCode).toBe(201);
  });

  it('the trial end starts billing on the next invoice: trial days are free', async () => {
    const period = addDays(`${colomboToday().slice(0, 7)}-01`, -1).slice(0, 7);
    const usage = (day: string, head: string, n: number) =>
      ownerDb('tenant_usage_daily').insert({
        tenant_id: tenantId,
        head,
        day,
        count_max: n,
        count_last: n,
      });
    // 80 students during the trial, 30 after it ends on the 10th.
    await usage(`${period}-01`, 'student', 80);
    await usage(`${period}-11`, 'student', 30);
    await endTrial(new Date(`${period}-10T20:00:00+05:30`));
    const [invoice] = await generateInvoices(appDb, period, { userId: ownerId });
    expect(invoice).toMatchObject({ total: '3000.00' });
    const row = await ownerDb('subscription_invoices').where({ id: invoice!.id }).first('lines');
    expect(row.lines).toEqual([expect.objectContaining({ head: 'student', peak: 30 })]);
  });

  it('a trial covering the whole month bills nothing', async () => {
    const period = addDays(`${colomboToday().slice(0, 7)}-01`, -1).slice(0, 7);
    await ownerDb('tenant_usage_daily').insert({
      tenant_id: tenantId,
      head: 'student',
      day: `${period}-01`,
      count_max: 80,
      count_last: 80,
    });
    expect(await generateInvoices(appDb, period, { userId: ownerId })).toEqual([]);
  });
});

describe('overdue and restricted', () => {
  it('overdue: everything works; the banner data has the amount and due date', async () => {
    await endTrial();
    await openInvoice(3);
    const e = (await call('GET', '')).json().entitlements;
    expect(e).toMatchObject({
      state: 'overdue',
      amountDue: '5000.00',
      overdueInvoice: 'S-TEST-3',
      overdueDueDate: addDays(colomboToday(), -3),
    });
    expect((await inviteStaff('0771000001')).statusCode).toBe(201);
  });

  it('after the grace period only new heads are refused', async () => {
    const mum = await signup('0722222222');
    const parentCode = (await portalInvite('0722222222')).json().code;
    await endTrial();
    await openInvoice(30);

    const student = await call('POST', '/students', { fullName: 'New' });
    expectError(student, 403, 'account_restricted');
    expect(student.json().details).toEqual({ amountDue: '5000.00', invoiceNumber: 'S-TEST-30' });
    expectError(await inviteStaff('0771000001'), 403, 'account_restricted');
    expectError(await accept(parentCode, mum.cookie), 403, 'account_restricted');

    // Fee collection, fee invoices, attendance setup and the Billing page keep working.
    expect((await call('POST', '/invoices/generate', { period: '2030-01' })).statusCode).toBe(200);
    const pay = await call('POST', '/payments', {
      studentId: kid,
      amount: '2500',
      clientRef: crypto.randomUUID(),
    });
    expect(pay.statusCode).toBe(201);
    expect((await call('POST', '/cards', { studentIds: [kid] })).statusCode).toBe(200);
    expect((await call('PATCH', `/students/${kid}`, { grade: '2027 A/L' })).statusCode).toBe(200);
    expect((await call('GET', '/billing')).statusCode).toBe(200);
  });

  it('subscription invoices are still generated for a restricted account', async () => {
    await endTrial(new Date('2020-01-01'));
    await openInvoice(30);
    const period = addDays(`${colomboToday().slice(0, 7)}-01`, -1).slice(0, 7);
    await ownerDb('tenant_usage_daily').insert({
      tenant_id: tenantId,
      head: 'student',
      day: `${period}-01`,
      count_max: 2,
      count_last: 2,
    });
    expect(await generateInvoices(appDb, period, { userId: ownerId })).toHaveLength(1);
  });

  it('family users are not blocked while restricted', async () => {
    const mum = await mother();
    await endTrial();
    await openInvoice(30);
    expect((await call('GET', '/portal', undefined, mum)).statusCode).toBe(200);
    expect((await uploadSlip(mum)).statusCode).toBe(201);
  });
});

describe('suspended: read-only', () => {
  const X = '00000000-0000-4000-8000-000000000000';
  // Every write under /tenants/:tenantId. Ids need not exist: the block comes before the handler.
  const writes: [string, string][] = [
    ['POST', '/students'],
    ['POST', '/students/import'],
    ['PATCH', `/students/${X}`],
    ['POST', '/subjects'],
    ['POST', '/batches'],
    ['PATCH', `/batches/${X}`],
    ['POST', `/batches/${X}/schedule`],
    ['DELETE', `/batches/${X}/schedule/${X}`],
    ['POST', `/batches/${X}/enrollments`],
    ['DELETE', `/batches/${X}/enrollments/${X}`],
    ['POST', `/batches/${X}/sessions`],
    ['PATCH', `/sessions/${X}`],
    ['PUT', `/batches/${X}/fees`],
    ['POST', `/students/${X}/concessions`],
    ['DELETE', `/students/${X}/concessions/${X}`],
    ['POST', '/invoices/generate'],
    ['POST', '/invoices'],
    ['POST', `/invoices/${X}/void`],
    ['POST', '/payments'],
    ['POST', '/cards'],
    ['POST', `/students/${X}/card/replace`],
    ['POST', '/attendance/scan'],
    ['PUT', `/sessions/${X}/attendance/${X}`],
    ['POST', `/students/${X}/portal-invite`],
    ['POST', `/slips/${X}/verify`],
    ['POST', `/slips/${X}/reject`],
    ['POST', '/invites'],
    ['DELETE', `/invites/${X}`],
    ['DELETE', `/members/${X}`],
  ];
  const reads = () => [
    '',
    '/students',
    `/students/${kid}`,
    '/batches',
    '/sessions',
    '/fees/month',
    '/slips',
    '/invites',
    '/members',
    '/reports/summary',
    '/reports/students.csv',
    '/billing',
  ];

  it.each(writes)('%s %s → 403 account_suspended', async (method, url) => {
    await suspend();
    expectError(await call(method, url, {}), 403, 'account_suspended');
  });

  it('reads keep working', async () => {
    await suspend();
    for (const url of reads()) {
      expect([url, (await call('GET', url)).statusCode]).toEqual([url, 200]);
    }
    expect((await call('GET', '')).json().entitlements).toMatchObject({
      state: 'suspended',
      writable: false,
    });
  });

  it('family users can read but not upload or join', async () => {
    const mum = await mother();
    const dad = await signup('0733333333');
    await call('POST', '/students', {
      fullName: 'Bimal',
      guardians: [{ fullName: 'Sunil', phone: '0733333333', relationship: 'father' }],
      force: true,
    });
    const bimal = await ownerDb('students').where({ full_name: 'Bimal' }).first('id');
    const code = (await portalInvite('0733333333', bimal.id)).json().code;
    await suspend();
    expect((await call('GET', '/portal', undefined, mum)).statusCode).toBe(200);
    expectError(await uploadSlip(mum), 403, 'account_suspended');
    expectError(await accept(code, dad.cookie), 403, 'account_suspended');
  });

  it('a new institute cannot be added to a suspended account', async () => {
    await setOverride('cap.institutes', 3);
    await suspend();
    expectError(
      await call('POST', '/api/v1/tenants', { name: 'Second', slug: 'second' }),
      403,
      'account_suspended',
    );
  });
});

describe('staff and parent caps', () => {
  it('teacher cap: checked when inviting and again when accepting', async () => {
    await setOverride('cap.teachers', 1);
    const a = await signup('0771000001');
    const b = await signup('0771000002');
    // Both invited while no teacher exists: pending invites do not count.
    const codeA = (await inviteStaff('0771000001')).json().code;
    const codeB = (await inviteStaff('0771000002')).json().code;
    expect((await accept(codeA, a.cookie)).statusCode).toBe(200);
    const refused = await accept(codeB, b.cookie);
    expectError(refused, 403, 'plan_limit');
    expect(refused.json().details).toEqual({ key: 'cap.teachers', limit: 1, used: 1 });
    expectError(await inviteStaff('0771000003'), 403, 'plan_limit');
    // An admin is not a teacher.
    expect((await inviteStaff('0771000004', 'admin')).statusCode).toBe(201);
  });

  it('parent cap: inviting is free, accepting is checked', async () => {
    await setOverride('cap.parents', 1);
    const sibling = (
      await call('POST', '/students', {
        fullName: 'Bimal',
        guardians: [
          { fullName: 'Kamala', phone: '0722222222', relationship: 'mother' },
          { fullName: 'Sunil', phone: '0733333333', relationship: 'father' },
        ],
        force: true,
      })
    ).json().student.id;
    const dad = await signup('0733333333');
    const dadCode = (await portalInvite('0733333333', sibling)).json().code;
    const mum = await mother();
    // The mother of a second child is not a new head.
    const second = (await portalInvite('0722222222', sibling)).json().code;
    expect((await accept(second, mum)).statusCode).toBe(200);
    const refused = await accept(dadCode, dad.cookie);
    expectError(refused, 403, 'plan_limit');
    expect(refused.json().details).toEqual({ key: 'cap.parents', limit: 1, used: 1 });
  });
});

describe('Billing page', () => {
  it('owners and admins only', async () => {
    const teacher = await member('0771000001', 'teacher');
    const desk = await member('0771000002', 'receptionist');
    const admin = await member('0771000003', 'admin');
    expectError(await call('GET', '/billing', undefined, teacher.cookie), 403, 'forbidden');
    expectError(await call('GET', '/billing', undefined, desk.cookie), 403, 'forbidden');
    expect((await call('GET', '/billing', undefined, admin.cookie)).statusCode).toBe(200);
  });

  it('this month’s estimate equals what generateInvoices bills for the same days', async () => {
    await endTrial(new Date('2020-01-01'));
    const period = colomboToday().slice(0, 7);
    // Opening count from last month, then today's heads (metered by the triggers).
    await ownerDb('tenant_usage_daily').insert({
      tenant_id: tenantId,
      head: 'parent',
      day: addDays(`${period}-01`, -1),
      count_max: 3,
      count_last: 3,
    });
    await call('POST', '/students', { fullName: 'Second' });
    await member('0771000001', 'teacher');

    const billing = (await call('GET', '/billing')).json();
    expect(billing.thisMonth.period).toBe(period);
    // 2 students × 100 + 1 teacher × 2000, plus 3 parents × 50 carried in from last month unless
    // today is the 1st (today's recount says 0 parents).
    expect(['2200.00', '2350.00']).toContain(billing.thisMonth.total);
    const settings = await ownerDb('platform_settings')
      .whereIn('key', ['bank_details', 'support_whatsapp'])
      .select('key', 'value');
    expect(billing.payTo).toEqual({
      bankDetails: settings.find((s) => s.key === 'bank_details')?.value ?? null,
      whatsapp: settings.find((s) => s.key === 'support_whatsapp')?.value ?? null,
    });
    expect(billing.prices).toMatchObject({ student: '100.00', teacher: '2000.00' });

    // Bill the month as if it had just ended, with no change after today.
    const nextMonth = new Date(`${addDays(`${period}-28`, 7).slice(0, 7)}-01T00:30:00+05:30`);
    const [invoice] = await generateInvoices(appDb, period, { userId: ownerId }, nextMonth);
    const row = await ownerDb('subscription_invoices').where({ id: invoice!.id }).first('lines');
    expect(invoice!.total).toBe(billing.thisMonth.total);
    expect(row.lines).toEqual(billing.thisMonth.lines);
    expect((await call('GET', '/billing')).json().invoices).toEqual([
      expect.objectContaining({ number: invoice!.number, total: invoice!.total, status: 'open' }),
    ]);
  });
});
