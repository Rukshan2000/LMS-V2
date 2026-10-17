import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision } from './provision.js';
import { colomboToday } from '../src/lib/time.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
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
async function addMember(userId: string, role: string) {
  const [m] = await ownerDb('tenant_memberships')
    .insert({ tenant_id: tenantId, user_id: userId })
    .returning('id');
  await ownerDb('membership_roles').insert({ tenant_id: tenantId, membership_id: m.id, role });
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });

async function student(fullName: string) {
  return (await call('POST', '/students', { fullName })).json().student.id as string;
}
const pay = (
  studentId: string,
  amount: string,
  clientRef: string = crypto.randomUUID(),
  cookie = owner,
) => call('POST', '/payments', { studentId, amount, clientRef }, cookie);
const fees = async (studentId: string) => (await call('GET', `/students/${studentId}/fees`)).json();
const invoiceFor = async (studentId: string, period: string) =>
  (await fees(studentId)).invoices.find((i: { period: string }) => i.period === period);

let batchId: string;
let a: string, b: string, c: string, d: string;

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
  await ownerDb.raw('TRUNCATE tenants, users CASCADE');
  ({ cookie: owner } = await signup('0770000001'));
  tenantId = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: { cookie: owner },
      payload: { name: 'Nimal Maths', slug: 'nimal-maths' },
    })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json().batch
    .id;
  await call('PUT', `/batches/${batchId}/fees`, { class: '2500', ac: 300, tute: '200.00' });
  [a, b, c, d] = [await student('A'), await student('B'), await student('C'), await student('D')];
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [a, b, c, d] });
  await call('POST', `/students/${b}/concessions`, { type: 'free_card', batchId });
  await call('POST', `/students/${c}/concessions`, { type: 'half_card' });
  await call('POST', `/students/${d}/concessions`, {
    type: 'percent',
    percent: 10,
    note: 'Sibling',
  });
});

describe('monthly billing', () => {
  it('bills class + AC + tute, applies concessions to the class fee only', async () => {
    const res = await call('POST', '/invoices/generate', { period: '2030-01' });
    expect(res.json().invoicesCreated).toBe(4);
    const totals = await Promise.all(
      [a, b, c, d].map(async (s) => (await invoiceFor(s, '2030-01')).total),
    );
    expect(totals).toEqual(['3000.00', '500.00', '1750.00', '2750.00']);
    const inv = await invoiceFor(a, '2030-01');
    expect(inv).toMatchObject({ dueDate: '2030-01-05', status: 'issued', paid: '0.00' });
    // Every amount, including inside JSON lines, is a string (never a float).
    expect(inv.lines.map((l: { kind: string; amount: unknown }) => [l.kind, l.amount])).toEqual([
      ['class', '2500.00'],
      ['ac', '300.00'],
      ['tute', '200.00'],
    ]);
    const half = await invoiceFor(c, '2030-01');
    expect(half.lines.find((l: { kind: string }) => l.kind === 'concession').amount).toBe(
      '-1250.00',
    );
  });

  it('running again changes nothing; a new class mid-month adds only its lines', async () => {
    await call('POST', '/invoices/generate', { period: '2030-01' });
    const again = (await call('POST', '/invoices/generate', { period: '2030-01' })).json();
    expect(again).toEqual({ invoicesCreated: 0, linesAdded: 0 });

    const extra = (
      await call('POST', '/batches', { name: 'Revision', subjectName: 'Maths' })
    ).json().batch.id;
    await call('PUT', `/batches/${extra}/fees`, { class: '1000' });
    await call('POST', `/batches/${extra}/enrollments`, { studentIds: [a] });
    const third = (await call('POST', '/invoices/generate', { period: '2030-01' })).json();
    expect(third).toEqual({ invoicesCreated: 0, linesAdded: 1 });
    expect((await invoiceFor(a, '2030-01')).total).toBe('4000.00');
    expect((await invoiceFor(c, '2030-01')).total).toBe('1750.00');
  });
});

describe('payments', () => {
  beforeEach(async () => {
    await call('POST', '/invoices/generate', { period: '2030-01' });
  });

  it('partial then full payment, numbered receipts, then nothing due', async () => {
    const first = await pay(a, '1000');
    expect(first.statusCode).toBe(201);
    expect(first.json().receipt).toMatchObject({
      receiptNumber: '1',
      amount: '1000.00',
      method: 'cash',
      receivedBy: 'User 0770000001',
    });
    expect(await invoiceFor(a, '2030-01')).toMatchObject({ paid: '1000.00', status: 'part_paid' });

    const second = await pay(a, '2000');
    expect(second.json().receipt.receiptNumber).toBe('2');
    expect(await invoiceFor(a, '2030-01')).toMatchObject({ paid: '3000.00', status: 'paid' });
    expect((await pay(a, '1')).json().code).toBe('nothing_due');
  });

  it('refuses more than what is due', async () => {
    const res = await pay(c, '2000');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'overpayment', details: { outstanding: '1750.00' } });
  });

  it('the same submit twice records one payment', async () => {
    const ref = crypto.randomUUID();
    const first = await pay(a, '500', ref);
    const repeat = await pay(a, '500', ref);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toMatchObject({
      duplicate: true,
      receipt: { id: first.json().receipt.id },
    });
    expect((await fees(a)).payments).toHaveLength(1);
    expect((await invoiceFor(a, '2030-01')).paid).toBe('500.00');
  });

  it('5 simultaneous full payments: exactly one goes through', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(a, '3000')));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(4);
    expect(await invoiceFor(a, '2030-01')).toMatchObject({ paid: '3000.00', status: 'paid' });
  });

  it('pays the oldest invoice first', async () => {
    await call('POST', '/invoices/generate', { period: '2030-02' });
    const res = await pay(a, '4000');
    expect(
      res
        .json()
        .receipt.allocations.map((x: { period: string; amount: string }) => [x.period, x.amount]),
    ).toEqual([
      ['2030-01', '3000.00'],
      ['2030-02', '1000.00'],
    ]);
    expect((await fees(a)).outstanding).toBe('2000.00');
  });

  it('one-off admission fee, void rules', async () => {
    const one = await call('POST', '/invoices', {
      studentId: b,
      lines: [{ kind: 'admission', description: 'Admission', amount: '1000' }],
    });
    expect(one.json().invoice).toMatchObject({ total: '1000.00', status: 'issued' });
    expect((await call('POST', `/invoices/${one.json().invoice.id}/void`)).statusCode).toBe(200);

    await pay(a, '100');
    const paidInv = await invoiceFor(a, '2030-01');
    expect((await call('POST', `/invoices/${paidInv.id}/void`)).json().code).toBe(
      'invoice_has_payments',
    );
  });

  it('month summary and not-paid list with parent phones', async () => {
    await call('PATCH', `/students/${d}`, {
      guardians: [{ fullName: 'Mum', phone: '0771234567', relationship: 'mother' }],
    });
    await pay(a, '3000');
    await pay(c, '750');
    const month = (await call('GET', '/fees/month?period=2030-01')).json();
    expect(month.summary).toEqual({
      invoices: 4,
      billed: '8000.00',
      collected: '3750.00',
      outstanding: '4250.00',
    });
    expect(
      month.unpaid.map((u: { fullName: string; balance: string }) => [u.fullName, u.balance]),
    ).toEqual([
      ['B', '500.00'],
      ['C', '1000.00'],
      ['D', '2750.00'],
    ]);
    expect(month.unpaid[2].guardians).toEqual([{ fullName: 'Mum', phone: '94771234567' }]);
  });
});

describe('fee roles and isolation', () => {
  it('receptionist takes payments but cannot change fees or concessions; teachers see nothing', async () => {
    await call('POST', '/invoices/generate', { period: '2030-01' });
    const r = await signup('0770000003');
    await addMember(r.userId, 'receptionist');
    expect((await pay(a, '500', crypto.randomUUID(), r.cookie)).statusCode).toBe(201);
    expect(
      (await call('PUT', `/batches/${batchId}/fees`, { class: '1' }, r.cookie)).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/students/${a}/concessions`, { type: 'free_card' }, r.cookie))
        .statusCode,
    ).toBe(403);

    const t = await signup('0770000002');
    await addMember(t.userId, 'teacher');
    expect((await pay(a, '500', crypto.randomUUID(), t.cookie)).statusCode).toBe(403);
    expect((await call('GET', `/students/${a}/fees`, undefined, t.cookie)).statusCode).toBe(403);
  });

  it('another institute cannot take a payment for this student', async () => {
    await call('POST', '/invoices/generate', { period: '2030-01' });
    const other = await signup('0770000009');
    const otherTenant = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/tenants',
        headers: { cookie: other.cookie },
        payload: { name: 'Other', slug: 'other-class' },
      })
    ).json().tenant.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${otherTenant}/payments`,
      headers: { cookie: other.cookie },
      payload: { studentId: a, amount: '100', clientRef: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it('scanning warns about unpaid fees without blocking entry', async () => {
    await call('POST', '/invoices', {
      studentId: a,
      dueDate: colomboToday(),
      lines: [{ kind: 'other', description: 'Exam paper', amount: '500' }],
    });
    const now = Date.now();
    await call('POST', `/batches/${batchId}/sessions`, {
      startsAt: new Date(now - 5 * 60_000).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
    });
    const res = await call('POST', '/attendance/scan', { code: '1001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attendance: { status: 'present' }, feeDue: '500.00' });
  });
});
