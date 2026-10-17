import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision, signupUser } from './provision.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

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

/** A class with one enrolled student and a one-off session from `start` to `end` minutes from now. */
async function setup(start: number, end: number, extra: object = {}) {
  const batch = (
    await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths', ...extra })
  ).json().batch;
  const student = (
    await call('POST', '/students', {
      fullName: 'Kasun Perera',
      guardians: [{ fullName: 'Nimali', phone: '0771234567', relationship: 'mother' }],
    })
  ).json().student;
  await call('POST', `/batches/${batch.id}/enrollments`, { studentIds: [student.id] });
  const session = (
    await call('POST', `/batches/${batch.id}/sessions`, {
      startsAt: minutes(start),
      endsAt: minutes(end),
    })
  ).json().session;
  const card = (await call('POST', '/cards', { batchId: batch.id })).json().cards[0];
  return { batch, student, session, card };
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
  tenantId = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: { cookie: owner },
      payload: { name: 'Nimal Maths', slug: 'nimal-maths' },
    })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
});

describe('cards', () => {
  it('creates one card per student, reuses it, and replacing revokes the old QR', async () => {
    const { batch, student, card } = await setup(-5, 120);
    expect(card.token).toMatch(/^[\w-]{16}$/);
    const again = (await call('POST', '/cards', { batchId: batch.id })).json().cards;
    expect(again[0].token).toBe(card.token);

    const replaced = (await call('POST', `/students/${student.id}/card/replace`)).json().card;
    expect(replaced.token).not.toBe(card.token);
    expect((await call('POST', '/attendance/scan', { code: card.token })).json().code).toBe(
      'card_not_found',
    );
    expect((await call('POST', '/attendance/scan', { code: replaced.token })).statusCode).toBe(200);
  });
});

describe('scan', () => {
  it('marks present once; repeated scans are reported as duplicates', async () => {
    const { session, card } = await setup(-5, 120);
    const first = await call('POST', '/attendance/scan', { code: card.token });
    expect(first.json()).toMatchObject({
      student: { fullName: 'Kasun Perera', studentNumber: '1001' },
      session: { id: session.id, batchName: 'Theory' },
      attendance: { status: 'present' },
      duplicate: false,
      guardians: [{ phone: '94771234567' }],
    });
    const second = await call('POST', '/attendance/scan', { code: card.token });
    expect(second.json()).toMatchObject({ duplicate: true, attendance: { status: 'present' } });
    expect(await ownerDb('attendance_records').count({ n: '*' }).first()).toEqual({ n: '1' });
  });

  it('marks late after 15 minutes, and accepts a typed student number', async () => {
    await setup(-30, 90);
    const res = await call('POST', '/attendance/scan', { code: '1001' });
    expect(res.json().attendance.status).toBe('late');
  });

  it('opens 60 minutes before start; outside the window there is no class', async () => {
    const early = await setup(45, 160);
    expect(
      (await call('POST', '/attendance/scan', { code: early.card.token })).json().attendance.status,
    ).toBe('present');
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
    const later = await setup(180, 300);
    const res = await call('POST', '/attendance/scan', { code: later.card.token });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: 'no_class_now',
      details: { student: { fullName: 'Kasun Perera' } },
    });
  });

  it('ignores cancelled classes and classes the student is not in', async () => {
    const { session, card, batch } = await setup(-5, 120);
    await call('PATCH', `/sessions/${session.id}`, { status: 'cancelled' });
    expect((await call('POST', '/attendance/scan', { code: card.token })).json().code).toBe(
      'no_class_now',
    );
    await call('PATCH', `/sessions/${session.id}`, { status: 'scheduled' });
    await call('DELETE', `/batches/${batch.id}/enrollments/${card.studentId}`);
    expect((await call('POST', '/attendance/scan', { code: card.token })).json().code).toBe(
      'no_class_now',
    );
  });

  it('refuses inactive students', async () => {
    const { student, card } = await setup(-5, 120);
    await call('PATCH', `/students/${student.id}`, { status: 'inactive' });
    expect((await call('POST', '/attendance/scan', { code: card.token })).json().code).toBe(
      'student_inactive',
    );
  });

  it("another institute's card does not work here", async () => {
    const { card } = await setup(-5, 120);
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
      url: `/api/v1/tenants/${otherTenant}/attendance/scan`,
      headers: { cookie: other.cookie },
      payload: { code: card.token },
    });
    expect(res.json().code).toBe('card_not_found');
  });

  it('20 simultaneous scans of the same card create one record', async () => {
    const { card } = await setup(-5, 120);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call('POST', '/attendance/scan', { code: card.token })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.filter((r) => !r.json().duplicate)).toHaveLength(1);
    expect(await ownerDb('attendance_records').count({ n: '*' }).first()).toEqual({ n: '1' });
  });
});

describe('register and corrections', () => {
  it('lists the class with marks; a manual change is audited', async () => {
    const { session, student, card } = await setup(-5, 120);
    const second = (await call('POST', '/students', { fullName: 'Amaya Silva' })).json().student;
    await call('POST', `/batches/${session.batchId}/enrollments`, { studentIds: [second.id] });
    await call('POST', '/attendance/scan', { code: card.token });

    const register = (await call('GET', `/sessions/${session.id}/attendance`)).json();
    expect(
      register.students.map((s: { fullName: string; status: string | null }) => [
        s.fullName,
        s.status,
      ]),
    ).toEqual([
      ['Amaya Silva', null],
      ['Kasun Perera', 'present'],
    ]);

    await call('PUT', `/sessions/${session.id}/attendance/${second.id}`, { status: 'absent' });
    const corrected = await call('PUT', `/sessions/${session.id}/attendance/${student.id}`, {
      status: 'late',
    });
    expect(corrected.json().attendance).toMatchObject({ status: 'late', method: 'scan' });
    const changes = await ownerDb('attendance_changes').select('old_status', 'new_status');
    expect(changes).toEqual([{ old_status: 'present', new_status: 'late' }]);
  });

  it('a teacher marks only their own classes; only desk staff can scan', async () => {
    const t = await signup('0770000002');
    const teacherId = await addMember(t.userId, 'teacher');
    const mine = await setup(-5, 120, { teacherMembershipId: teacherId });
    const theirs = (await call('POST', '/batches', { name: 'Other', subjectName: 'Maths' })).json()
      .batch;
    const otherSession = (
      await call('POST', `/batches/${theirs.id}/sessions`, {
        startsAt: minutes(-5),
        endsAt: minutes(60),
      })
    ).json().session;
    const as = (method: string, url: string, payload?: unknown) =>
      call(method, url, payload, t.cookie);

    expect((await as('GET', `/sessions/${mine.session.id}/attendance`)).statusCode).toBe(200);
    expect(
      (
        await as('PUT', `/sessions/${mine.session.id}/attendance/${mine.student.id}`, {
          status: 'present',
        })
      ).statusCode,
    ).toBe(200);
    expect((await as('GET', `/sessions/${otherSession.id}/attendance`)).statusCode).toBe(404);
    expect((await as('POST', '/attendance/scan', { code: mine.card.token })).statusCode).toBe(403);

    const r = await signup('0770000003');
    await addMember(r.userId, 'receptionist');
    expect(
      (await call('POST', '/attendance/scan', { code: mine.card.token }, r.cookie)).statusCode,
    ).toBe(200);
  });
});
