import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision, signupUser } from './provision.js';

// Tutes: class notes with a download link. Teachers manage only their own classes' tutes;
// students and parents see the tutes of their enrolled classes.

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName: `User ${phone}` });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
}

async function addMember(userId: string, role: string) {
  const [m] = await ownerDb('tenant_memberships')
    .insert({ tenant_id: tenantId, user_id: userId })
    .returning('id');
  await ownerDb('membership_roles').insert({ tenant_id: tenantId, membership_id: m.id, role });
  return m.id as string;
}

const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });

async function createBatch(name: string, extra: object = {}) {
  const res = await call('POST', '/batches', { name, subjectName: 'Chemistry', ...extra });
  return res.json().batch.id as string;
}

const tute = (batchId: string, title = 'Unit 1 notes') => ({
  batchId,
  title,
  description: 'Atomic structure',
  url: 'https://drive.google.com/file/d/abc/view',
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
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tenants',
    headers: { cookie: owner },
    payload: { name: 'Nimal Maths', slug: 'nimal-maths' },
  });
  tenantId = res.json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
});

describe('tutes', () => {
  it('a teacher adds, edits and deletes tutes only for their own classes', async () => {
    const t = await signup('0770000002');
    const teacherId = await addMember(t.userId, 'teacher');
    const mine = await createBatch('Mine', { teacherMembershipId: teacherId });
    const other = await createBatch('Other');

    const created = await call('POST', '/tutes', tute(mine), t.cookie);
    expect(created.statusCode).toBe(201);
    expect(created.json().tute).toMatchObject({ batchName: 'Mine', title: 'Unit 1 notes' });
    const id = created.json().tute.id;
    expect((await call('POST', '/tutes', tute(other), t.cookie)).statusCode).toBe(400);

    // The owner's tute in another class is invisible to the teacher.
    const ownerTute = (await call('POST', '/tutes', tute(other, 'Owner notes'))).json().tute.id;
    expect((await call('GET', '/tutes', undefined, t.cookie)).json().tutes).toHaveLength(1);
    expect((await call('GET', '/tutes')).json().tutes).toHaveLength(2);
    expect((await call('DELETE', `/tutes/${ownerTute}`, undefined, t.cookie)).statusCode).toBe(404);

    const edited = await call('PATCH', `/tutes/${id}`, { title: 'Unit 1 (v2)' }, t.cookie);
    expect(edited.json().tute.title).toBe('Unit 1 (v2)');
    expect((await call('DELETE', `/tutes/${id}`, undefined, t.cookie)).statusCode).toBe(204);
  });

  it('only https links are accepted', async () => {
    const batch = await createBatch('Theory');
    const res = await call('POST', '/tutes', { ...tute(batch), url: 'http://example.com/a.pdf' });
    expect(res.statusCode).toBe(400);
  });

  it('students and parents see tutes of their enrolled classes only', async () => {
    const enrolled = await createBatch('Enrolled');
    const notEnrolled = await createBatch('Not enrolled');
    await call('POST', '/tutes', tute(enrolled, 'Mine'));
    await call('POST', '/tutes', tute(notEnrolled, 'Not mine'));
    const studentId = (await call('POST', '/students', { fullName: 'Kasun' })).json().student.id;
    await call('POST', `/batches/${enrolled}/enrollments`, { studentIds: [studentId] });

    const s = await signup('0770000003');
    const membershipId = await addMember(s.userId, 'student');
    await ownerDb('portal_access').insert({
      tenant_id: tenantId,
      membership_id: membershipId,
      student_id: studentId,
    });
    const res = await call('GET', '/portal/tutes', undefined, s.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().tutes.map((x: { title: string }) => x.title)).toEqual(['Mine']);
    // Students cannot use the staff routes.
    expect((await call('GET', '/tutes', undefined, s.cookie)).statusCode).toBe(403);
    expect((await call('POST', '/tutes', tute(enrolled), s.cookie)).statusCode).toBe(403);
  });
});
