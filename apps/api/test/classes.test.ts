import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { addDays, colomboToday } from '../src/lib/time.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;

async function signup(phone: string) {
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
  const res = await call('POST', '/batches', { name, subjectName: 'Combined Maths', ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().batch;
}

async function createStudent(fullName: string) {
  const res = await call('POST', '/students', { fullName });
  return res.json().student.id as string;
}

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

describe('classes and subjects', () => {
  it('creates a class with a new subject and reuses it case-insensitively', async () => {
    const a = await createBatch('2027 A/L Theory');
    const b = await createBatch('2027 A/L Revision', { subjectName: 'combined maths' });
    expect(a).toMatchObject({ subjectName: 'Combined Maths', mode: 'physical', status: 'active' });
    expect(b.subjectId).toBe(a.subjectId);
    expect((await call('GET', '/subjects')).json().subjects).toHaveLength(1);
  });

  it('assigns a teacher from the member list', async () => {
    const t = await signup('0770000002');
    const teacherId = await addMember(t.userId, 'teacher');
    const members = (await call('GET', '/members')).json().members;
    expect(
      members.find((m: { membershipId: string }) => m.membershipId === teacherId).roles,
    ).toEqual(['teacher']);
    const batch = await createBatch('Theory', { teacherMembershipId: teacherId });
    expect(batch.teacherName).toBe('User 0770000002');
  });

  it("rejects another tenant's subject or teacher", async () => {
    const other = await signup('0770000009');
    const otherTenant = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/tenants',
        headers: { cookie: other.cookie },
        payload: { name: 'Other', slug: 'other-class' },
      })
    ).json().tenant.id;
    const subject = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/tenants/${otherTenant}/subjects`,
        headers: { cookie: other.cookie },
        payload: { name: 'Physics' },
      })
    ).json().subject;
    const res = await call('POST', '/batches', { name: 'X', subjectId: subject.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_reference');
  });
});

describe('weekly schedule and sessions', () => {
  // 2030-01-05 is a Saturday (ISO weekday 6).
  const rule = { weekday: 6, startTime: '14:00', endTime: '17:00', validFrom: '2030-01-01' };

  it('generates sessions in Sri Lanka time, once, for each matching day', async () => {
    const batch = await createBatch('Theory');
    await call('POST', `/batches/${batch.id}/schedule`, rule);
    const get = () => call('GET', '/sessions?from=2030-01-01&to=2030-01-31');
    const first = (await get()).json().sessions;
    const again = (await get()).json().sessions;
    expect(first.map((s: { startsAt: string }) => new Date(s.startsAt).toISOString())).toEqual([
      '2030-01-05T08:30:00.000Z',
      '2030-01-12T08:30:00.000Z',
      '2030-01-19T08:30:00.000Z',
      '2030-01-26T08:30:00.000Z',
    ]);
    expect(again).toHaveLength(4);
    expect(first[0]).toMatchObject({
      batchName: 'Theory',
      subjectName: 'Combined Maths',
      status: 'scheduled',
    });
  });

  it('cancels or moves one session; regenerating never recreates the original slot', async () => {
    const batch = await createBatch('Theory');
    await call('POST', `/batches/${batch.id}/schedule`, rule);
    const [s1, s2] = (await call('GET', '/sessions?from=2030-01-01&to=2030-01-13')).json().sessions;
    await call('PATCH', `/sessions/${s1.id}`, { status: 'cancelled', note: 'Exam day' });
    const moved = await call('PATCH', `/sessions/${s2.id}`, {
      startsAt: '2030-01-13T09:00:00+05:30',
      endsAt: '2030-01-13T12:00:00+05:30',
    });
    expect(moved.statusCode).toBe(200);
    const after = (await call('GET', '/sessions?from=2030-01-01&to=2030-01-13')).json().sessions;
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: s1.id, status: 'cancelled', note: 'Exam day' });
    expect(new Date(after[1].startsAt).toISOString()).toBe('2030-01-13T03:30:00.000Z');
    const bad = await call('PATCH', `/sessions/${s2.id}`, { endsAt: '2030-01-13T08:00:00+05:30' });
    expect(bad.json().code).toBe('end_before_start');
  });

  it('adds an extra one-off class', async () => {
    const batch = await createBatch('Theory');
    const res = await call('POST', `/batches/${batch.id}/sessions`, {
      startsAt: '2030-02-01T08:00:00+05:30',
      endsAt: '2030-02-01T12:00:00+05:30',
      note: 'Revision day',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().session).toMatchObject({ isExtra: true, note: 'Revision day' });
  });

  it('ending a slot removes future sessions but keeps past ones', async () => {
    const batch = await createBatch('Theory');
    const today = colomboToday();
    const start = addDays(today, -21);
    const weekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    await call('POST', `/batches/${batch.id}/schedule`, { ...rule, weekday, validFrom: start });
    await call('GET', `/sessions?from=${start}&to=${addDays(today, 21)}`);
    const ruleId = (await call('GET', `/batches/${batch.id}`)).json().batch.schedule[0].id;
    const ended = await call('DELETE', `/batches/${batch.id}/schedule/${ruleId}`);
    expect(ended.json().batch.schedule).toHaveLength(1); // still valid today
    const remaining = (await call('GET', `/sessions?from=${start}&to=${addDays(today, 21)}`)).json()
      .sessions;
    const days = remaining.map((s: { startsAt: string }) => colomboToday(new Date(s.startsAt)));
    expect(days).toEqual([addDays(today, -21), addDays(today, -14), addDays(today, -7), today]);
  });

  it('a slot that never started is removed completely', async () => {
    const batch = await createBatch('Theory');
    await call('POST', `/batches/${batch.id}/schedule`, rule);
    const ruleId = (await call('GET', `/batches/${batch.id}`)).json().batch.schedule[0].id;
    await call('DELETE', `/batches/${batch.id}/schedule/${ruleId}`);
    expect((await call('GET', '/sessions?from=2030-01-01&to=2030-01-31')).json().sessions).toEqual(
      [],
    );
    expect(await ownerDb('schedule_rules').count({ n: '*' }).first()).toEqual({ n: '0' });
  });

  it('validates times and the date range', async () => {
    const batch = await createBatch('Theory');
    const bad = await call('POST', `/batches/${batch.id}/schedule`, { ...rule, endTime: '13:00' });
    expect(bad.statusCode).toBe(400);
    const range = await call('GET', '/sessions?from=2030-01-01&to=2030-06-01');
    expect(range.json().code).toBe('invalid_range');
  });
});

describe('enrollments', () => {
  it('enrolls idempotently, removes, and re-enrolls with history', async () => {
    const batch = await createBatch('Theory');
    const a = await createStudent('Kasun');
    const b = await createStudent('Amaya');
    const first = await call('POST', `/batches/${batch.id}/enrollments`, { studentIds: [a, b] });
    expect(first.json().added).toBe(2);
    expect(
      (await call('POST', `/batches/${batch.id}/enrollments`, { studentIds: [a] })).json().added,
    ).toBe(0);
    expect(first.json().batch.students.map((s: { fullName: string }) => s.fullName)).toEqual([
      'Amaya',
      'Kasun',
    ]);

    await call('DELETE', `/batches/${batch.id}/enrollments/${a}`);
    expect((await call('GET', `/students/${a}`)).json().student.classes).toEqual([]);
    expect(
      (await call('POST', `/batches/${batch.id}/enrollments`, { studentIds: [a] })).json().added,
    ).toBe(1);
    expect(await ownerDb('enrollments').where({ student_id: a }).count({ n: '*' }).first()).toEqual(
      { n: '2' },
    );
    expect((await call('GET', `/students/${a}`)).json().student.classes[0].name).toBe('Theory');
  });

  it("cannot enroll another tenant's student", async () => {
    const batch = await createBatch('Theory');
    const other = await signup('0770000009');
    const otherTenant = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/tenants',
        headers: { cookie: other.cookie },
        payload: { name: 'Other', slug: 'other-class' },
      })
    ).json().tenant.id;
    const foreign = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/tenants/${otherTenant}/students`,
        headers: { cookie: other.cookie },
        payload: { fullName: 'Not yours' },
      })
    ).json().student.id;
    const res = await call('POST', `/batches/${batch.id}/enrollments`, { studentIds: [foreign] });
    expect(res.statusCode).toBe(400);
  });
});

describe('roles', () => {
  it('a teacher sees only their own classes, sessions and students', async () => {
    const t = await signup('0770000002');
    const teacherId = await addMember(t.userId, 'teacher');
    const mine = await createBatch('Mine', { teacherMembershipId: teacherId });
    const theirs = await createBatch('Not mine');
    const s1 = await createStudent('In my class');
    const s2 = await createStudent('Elsewhere');
    await call('POST', `/batches/${mine.id}/enrollments`, { studentIds: [s1] });
    await call('POST', `/batches/${theirs.id}/enrollments`, { studentIds: [s2] });
    for (const b of [mine, theirs]) {
      await call('POST', `/batches/${b.id}/schedule`, {
        weekday: 6,
        startTime: '14:00',
        endTime: '15:00',
        validFrom: '2030-01-01',
      });
    }
    const as = (url: string, method = 'GET', payload?: unknown) =>
      call(method, url, payload, t.cookie);

    expect((await as('/batches')).json().batches.map((b: { name: string }) => b.name)).toEqual([
      'Mine',
    ]);
    expect((await as(`/batches/${theirs.id}`)).statusCode).toBe(404);
    const sessions = (await as('/sessions?from=2030-01-01&to=2030-01-07')).json().sessions;
    expect(sessions.map((s: { batchName: string }) => s.batchName)).toEqual(['Mine']);
    expect(
      (await as('/students')).json().students.map((s: { fullName: string }) => s.fullName),
    ).toEqual(['In my class']);
    expect((await as(`/students/${s2}`)).statusCode).toBe(404);
    // Can cancel own class, not someone else's; cannot create classes or students.
    const theirSession = (
      await call('GET', `/sessions?from=2030-01-01&to=2030-01-07&batchId=${theirs.id}`)
    ).json().sessions[0];
    expect(
      (await as(`/sessions/${theirSession.id}`, 'PATCH', { status: 'cancelled' })).statusCode,
    ).toBe(404);
    expect(
      (await as(`/sessions/${sessions[0].id}`, 'PATCH', { status: 'cancelled' })).statusCode,
    ).toBe(200);
    expect((await as('/batches', 'POST', { name: 'X', subjectName: 'Y' })).statusCode).toBe(403);
    expect((await as('/students', 'POST', { fullName: 'X' })).statusCode).toBe(403);
  });

  it('a receptionist can enroll students but not create classes', async () => {
    const r = await signup('0770000003');
    await addMember(r.userId, 'receptionist');
    const batch = await createBatch('Theory');
    const s = await createStudent('Kasun');
    const enroll = await call(
      'POST',
      `/batches/${batch.id}/enrollments`,
      { studentIds: [s] },
      r.cookie,
    );
    expect(enroll.statusCode).toBe(200);
    const create = await call('POST', '/batches', { name: 'X', subjectName: 'Y' }, r.cookie);
    expect(create.statusCode).toBe(403);
  });
});
