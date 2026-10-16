import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;

const call = (method: string, url: string, payload?: unknown) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie: owner },
    payload: payload as object,
  });
const addStudent = (fullName: string) => call('POST', '/students', { fullName });
/** Fill the tenant up to `n` active students directly in the DB (fast). */
const seedStudents = (n: number) =>
  ownerDb('students').insert(
    Array.from({ length: n }, (_, i) => ({
      tenant_id: tenantId,
      student_number: String(9000 + i),
      full_name: `Seed ${i}`,
    })),
  );
const setPlan = (plan: string, expires: Date | null) =>
  ownerDb('tenants').where({ id: tenantId }).update({ plan, plan_expires_at: expires });

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
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      phone: '0770000001',
      password: 'correct-horse',
      acceptPrivacy: true,
      fullName: 'Owner',
    },
  });
  owner = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
  tenantId = (
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
});

describe('plan limits', () => {
  it('Free allows 50 active students and blocks the 51st without touching data', async () => {
    await seedStudents(49);
    expect((await addStudent('Fiftieth')).statusCode).toBe(201);
    const res = await addStudent('Fifty-first');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'plan_limit' });
    const { usage } = (await call('GET', '')).json();
    expect(usage).toMatchObject({ effectivePlan: 'free', studentLimit: 50, activeStudents: 50 });
  });

  it('inactive students do not count, but re-activating one is checked', async () => {
    await seedStudents(50);
    const one = await ownerDb('students').where({ tenant_id: tenantId }).first('id');
    await call('PATCH', `/students/${one.id}`, { status: 'inactive' });
    const added = await addStudent('New');
    expect(added.statusCode).toBe(201);
    expect((await call('PATCH', `/students/${one.id}`, { status: 'active' })).statusCode).toBe(403);
    // Editing an active student at the limit is fine.
    expect(
      (await call('PATCH', `/students/${added.json().student.id}`, { grade: '2027 A/L' }))
        .statusCode,
    ).toBe(200);
  });

  it('CSV import that would go over the limit is refused as a whole', async () => {
    await seedStudents(49);
    const csv = 'name,phone\nKasun,0771111111\nNimal,0772222222\n';
    const res = await app.inject({
      method: 'POST',
      url: `${api}/students/import?dryRun=false`,
      headers: { cookie: owner, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().result).toMatchObject({ created: 0, errors: [{ code: 'plan_limit' }] });
  });

  it('a paid plan lifts the limit until it expires', async () => {
    await seedStudents(50);
    await setPlan('teacher', new Date(Date.now() + 30 * 86400_000));
    expect((await addStudent('Paid')).statusCode).toBe(201);
    await setPlan('teacher', new Date(Date.now() - 1000));
    expect((await addStudent('Expired')).statusCode).toBe(403);
    expect((await call('GET', '')).json().usage).toMatchObject({
      plan: 'teacher',
      effectivePlan: 'free',
      activeStudents: 51,
    });
  });

  it('two desks adding the last free place at once: only one succeeds', async () => {
    await seedStudents(49);
    const results = await Promise.all(['A', 'B', 'C'].map((n) => addStudent(n)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403, 403]);
  });
});
