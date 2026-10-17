import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision, signupUser } from './provision.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let cookie: string;
let tenantId: string;
let base: string;

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName: 'Owner' });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
}

async function createTenant(c: string, slug: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tenants',
    headers: { cookie: c },
    payload: { name: slug, slug },
  });
  return res.json().tenant.id as string;
}

const post = (url: string, payload: unknown, c = cookie) =>
  app.inject({ method: 'POST', url, headers: { cookie: c }, payload: payload as object });

const kasun = {
  fullName: 'Kasun Perera',
  grade: '2027 A/L',
  guardians: [{ fullName: 'Nimali Perera', phone: '0771234567', relationship: 'mother' }],
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
  await ownerDb.raw('TRUNCATE tenants, users CASCADE');
  ({ cookie } = await signup('0770000001'));
  tenantId = await createTenant(cookie, 'nimal-maths');
  base = `/api/v1/tenants/${tenantId}/students`;
});

describe('students', () => {
  it('creates a student with a guardian and numbers students per tenant', async () => {
    const res = await post(base, kasun);
    expect(res.statusCode).toBe(201);
    expect(res.json().student).toMatchObject({
      studentNumber: '1001',
      fullName: 'Kasun Perera',
      status: 'active',
      guardians: [{ fullName: 'Nimali Perera', phone: '94771234567', relationship: 'mother' }],
    });
    const second = await post(base, { fullName: 'Amaya Silva' });
    expect(second.json().student.studentNumber).toBe('1002');
  });

  it('siblings share one guardian record by phone', async () => {
    await post(base, kasun);
    await post(base, { ...kasun, fullName: 'Dilini Perera' });
    expect(await ownerDb('guardians').count({ n: '*' }).first()).toEqual({ n: '1' });
    expect(await ownerDb('student_guardians').count({ n: '*' }).first()).toEqual({ n: '2' });
  });

  it('warns about a possible duplicate, and allows it when confirmed', async () => {
    const first = (await post(base, kasun)).json().student;
    const dup = await post(base, { ...kasun, fullName: 'kasun perera' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({
      code: 'possible_duplicate',
      details: { existing: { id: first.id, studentNumber: '1001' } },
    });
    const forced = await post(base, { ...kasun, allowDuplicate: true });
    expect(forced.statusCode).toBe(201);
  });

  it('rejects an invalid guardian phone', async () => {
    const res = await post(base, {
      ...kasun,
      guardians: [{ fullName: 'X', phone: '12345', relationship: 'mother' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toHaveProperty(['guardians']);
  });

  it('searches by name, student number and guardian phone (0-prefixed)', async () => {
    await post(base, kasun);
    await post(base, { fullName: 'Amaya Silva' });
    const search = async (q: string) =>
      (await app.inject({ url: `${base}?q=${encodeURIComponent(q)}`, headers: { cookie } }))
        .json()
        .students.map((s: { fullName: string }) => s.fullName);
    expect(await search('kasun')).toEqual(['Kasun Perera']);
    expect(await search('1002')).toEqual(['Amaya Silva']);
    expect(await search('0771234567')).toEqual(['Kasun Perera']);
    expect(await search('%')).toEqual([]);
  });

  it('pages through students with a cursor', async () => {
    for (const name of ['A', 'B', 'C', 'D', 'E']) await post(base, { fullName: name });
    const names: string[] = [];
    let url = `${base}?limit=2`;
    for (;;) {
      const page = (await app.inject({ url, headers: { cookie } })).json();
      names.push(...page.students.map((s: { fullName: string }) => s.fullName));
      if (!page.nextCursor) break;
      url = `${base}?limit=2&cursor=${page.nextCursor}`;
    }
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('updates details, guardians and status; inactive students leave the default list', async () => {
    const { id } = (await post(base, kasun)).json().student;
    const res = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      headers: { cookie },
      payload: {
        grade: '2028 A/L',
        status: 'inactive',
        guardians: [{ fullName: 'Sunil Perera', phone: '0712223333', relationship: 'father' }],
      },
    });
    expect(res.json().student).toMatchObject({
      grade: '2028 A/L',
      status: 'inactive',
      guardians: [{ fullName: 'Sunil Perera', relationship: 'father' }],
    });
    const list = (await app.inject({ url: base, headers: { cookie } })).json();
    expect(list.students).toEqual([]);
    const all = (await app.inject({ url: `${base}?status=all`, headers: { cookie } })).json();
    expect(all.students).toHaveLength(1);
  });

  it('another tenant cannot list, read or edit these students', async () => {
    const { id } = (await post(base, kasun)).json().student;
    const other = await signup('0770000002');
    const otherTenant = await createTenant(other.cookie, 'other-class');
    // Own tenant: empty list.
    const own = await app.inject({
      url: `/api/v1/tenants/${otherTenant}/students`,
      headers: { cookie: other.cookie },
    });
    expect(own.json().students).toEqual([]);
    // Guessing the student id under their own tenant: 404.
    const read = await app.inject({
      url: `/api/v1/tenants/${otherTenant}/students/${id}`,
      headers: { cookie: other.cookie },
    });
    expect(read.statusCode).toBe(404);
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${otherTenant}/students/${id}`,
      headers: { cookie: other.cookie },
      payload: { fullName: 'hacked' },
    });
    expect(edit.statusCode).toBe(404);
    // Using the first tenant's URL: not a member → 404.
    const foreign = await app.inject({ url: base, headers: { cookie: other.cookie } });
    expect(foreign.statusCode).toBe(404);
    expect((await ownerDb('students').where({ id }).first()).full_name).toBe('Kasun Perera');
  });

  it('student and parent roles cannot use the staff student list', async () => {
    const member = await signup('0770000003');
    const [m] = await ownerDb('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: member.userId })
      .returning('id');
    await ownerDb('membership_roles').insert({
      tenant_id: tenantId,
      membership_id: m.id,
      role: 'parent',
    });
    const res = await app.inject({ url: base, headers: { cookie: member.cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('CSV import', () => {
  const importCsv = (csv: string, dryRun: boolean) =>
    app.inject({
      method: 'POST',
      url: `${base}/import?dryRun=${dryRun}`,
      headers: { cookie, 'content-type': 'text/csv' },
      payload: csv,
    });

  const csv = [
    'Name,Grade,Guardian Name,Guardian Phone,Relationship',
    'Kasun Perera,2027 A/L,Nimali Perera,077 123 4567,Mother',
    'Dilini Perera,2028 A/L,Nimali Perera,0771234567,mother',
    '"Silva, Amaya",Grade 10,,,',
    'Kasun Perera,2027 A/L,Nimali Perera,0771234567,mother',
  ].join('\n');

  it('dry run reports what would happen without writing', async () => {
    const res = await importCsv(csv, true);
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      total: 4,
      ready: 3,
      created: 0,
      errors: [],
      skipped: [{ line: 5, code: 'duplicate_in_file' }],
    });
    expect(await ownerDb('students').count({ n: '*' }).first()).toEqual({ n: '0' });
  });

  it('commit creates students and links siblings to one guardian; re-import skips them', async () => {
    const res = await importCsv(csv, false);
    expect(res.json().result.created).toBe(3);
    expect(await ownerDb('guardians').count({ n: '*' }).first()).toEqual({ n: '1' });
    const again = (await importCsv(csv, false)).json().result;
    expect(again.created).toBe(0);
    expect(
      again.skipped.filter((s: { code: string }) => s.code === 'duplicate_in_db'),
    ).toHaveLength(3);
  });

  it('any invalid row blocks the whole import and reports the line', async () => {
    const bad = `${csv}\n,2027 A/L,X,0771111111,mother\nNuwan,,Y,123,father`;
    const res = await importCsv(bad, false);
    expect(res.statusCode).toBe(400);
    const { errors, created } = res.json().result;
    expect(created).toBe(0);
    expect(errors.map((e: { line: number }) => e.line)).toEqual([6, 7]);
    expect(await ownerDb('students').count({ n: '*' }).first()).toEqual({ n: '0' });
  });

  it('reads student and guardian emails (for portal invites); a bad email blocks the row', async () => {
    const withEmail = [
      'Name,Email,Guardian Name,Guardian Phone,Guardian Email',
      'Kasun Perera,Kasun@Example.com,Nimali Perera,0771234567,NIMALI@example.com',
    ].join('\n');
    expect((await importCsv(withEmail, false)).json().result.created).toBe(1);
    expect(await ownerDb('students').first('email')).toEqual({ email: 'kasun@example.com' });
    expect(await ownerDb('guardians').first('email')).toEqual({ email: 'nimali@example.com' });

    const bad = await importCsv('Name,Email\nAmal,not-an-email', true);
    expect(bad.json().result.errors).toMatchObject([{ line: 2, field: 'email' }]);
  });

  it('requires a name column', async () => {
    const res = await importCsv('Grade,Phone\n10,0771234567', true);
    expect(res.json().result.errors[0].message).toBe('missing_name_column');
  });
});
