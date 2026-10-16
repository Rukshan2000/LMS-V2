import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { parseCsv } from '../src/lib/csv.js';
import { colomboToday } from '../src/lib/time.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;
let kid1: string, kid2: string, batchId: string;
const thisMonth = colomboToday().slice(0, 7);

async function signup(phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
  return {
    cookie: `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`,
    id: res.json().user.id,
  };
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });

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
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  const add = async (fullName: string) =>
    (
      await call('POST', '/students', {
        fullName,
        guardians: [{ fullName: 'Kamala', phone: '0722222222', relationship: 'mother' }],
        force: true,
      })
    ).json().student.id as string;
  kid1 = await add('=cmd|calc'); // formula-looking name must not run in Excel
  kid2 = await add('Bimal');
  batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json().batch
    .id;
  await call('PUT', `/batches/${batchId}/fees`, { class: '2500' });
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [kid1, kid2] });
  await call('POST', '/invoices/generate', { period: thisMonth });
  await call('POST', '/payments', {
    studentId: kid1,
    amount: '2500',
    clientRef: crypto.randomUUID(),
  });
  await call('POST', '/payments', {
    studentId: kid2,
    amount: '1000',
    clientRef: crypto.randomUUID(),
  });
});

describe('reports', () => {
  it('summarises billing, money received and attendance for the month', async () => {
    const session = (
      await call('POST', `/batches/${batchId}/sessions`, {
        startsAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        endsAt: new Date(Date.now() - 3600_000).toISOString(),
      })
    ).json().session;
    await call('PUT', `/sessions/${session.id}/attendance/${kid1}`, { status: 'present' });
    await call('PUT', `/sessions/${session.id}/attendance/${kid2}`, { status: 'absent' });

    const res = await call('GET', `/reports/summary?from=${thisMonth}&to=${thisMonth}`);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.months).toEqual([
      {
        period: thisMonth,
        invoices: 2,
        billed: '5000.00',
        paid: '3500.00',
        outstanding: '1500.00',
      },
    ]);
    expect(r.received).toEqual([
      { month: thisMonth, method: 'cash', payments: 2, amount: '3500.00' },
    ]);
    expect(r.daily).toEqual([{ day: colomboToday(), payments: 2, amount: '3500.00' }]);
    expect(r.attendance).toEqual([
      expect.objectContaining({ name: 'Theory', sessions: 1, present: 1, absent: 1, enrolled: 2 }),
    ]);
  });

  it('exports CSV files that open safely in Excel', async () => {
    const pay = await call('GET', `/reports/payments.csv?from=${thisMonth}&to=${thisMonth}`);
    expect(pay.headers['content-type']).toContain('text/csv');
    expect(pay.headers['content-disposition']).toMatch(/attachment; filename="payments-/);
    const rows = parseCsv(pay.body);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(expect.arrayContaining(["'=cmd|calc", '2500.00', 'cash']));

    const unpaid = parseCsv((await call('GET', '/reports/unpaid.csv')).body);
    expect(unpaid.slice(1).map((r) => [r[1], r[8]])).toEqual([['Bimal', '1500.00']]);

    const students = parseCsv((await call('GET', '/reports/students.csv')).body);
    expect(students[1]).toEqual(expect.arrayContaining(['Kamala 94722222222', 'Theory']));
  });

  it('is for owners and admins only, and limits the range', async () => {
    const teacher = await signup('0712345678');
    const [m] = await ownerDb('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: teacher.id })
      .returning('id');
    await ownerDb('membership_roles').insert({
      tenant_id: tenantId,
      membership_id: m.id,
      role: 'receptionist',
    });
    expect((await call('GET', '/reports/summary', undefined, teacher.cookie)).statusCode).toBe(403);
    expect((await call('GET', '/reports/students.csv', undefined, teacher.cookie)).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/reports/summary?from=2020-01&to=2026-01')).statusCode).toBe(400);
  });
});
