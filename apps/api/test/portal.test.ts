import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { colomboToday } from '../src/lib/time.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;
let kid1: string, kid2: string, other: string;

async function signup(phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return `sid=${sid.value}`;
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });

async function student(fullName: string, phone: string | null, guardianPhone: string) {
  const res = await call('POST', '/students', {
    fullName,
    phone,
    guardians: [{ fullName: 'Kamala', phone: guardianPhone, relationship: 'mother' }],
    force: true,
  });
  expect(res.statusCode).toBe(201);
  return res.json().student.id as string;
}
async function invite(studentId: string, phone: string) {
  const res = await call('POST', `/students/${studentId}/portal-invite`, { phone });
  expect(res.statusCode).toBe(201);
  return res.json().code as string;
}
const accept = (code: string, cookie: string) =>
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
  await ownerDb.raw('TRUNCATE tenants, users CASCADE');
  owner = await signup('0770000001');
  tenantId = (
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  // Two siblings share a mother; a third student has a different family.
  kid1 = await student('Amal', '0711111111', '0722222222');
  kid2 = await student('Bimal', null, '0722222222');
  other = await student('Chamal', null, '0733333333');
  const batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json()
    .batch.id;
  await call('PUT', `/batches/${batchId}/fees`, { class: '2500' });
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [kid1, kid2, other] });
  await call('POST', '/invoices/generate', { period: '2030-01' });
});

describe('portal', () => {
  it('a parent sees exactly the children they were invited for', async () => {
    const mother = await signup('0722222222');
    expect((await accept(await invite(kid1, '0722222222'), mother)).statusCode).toBe(200);
    expect((await accept(await invite(kid2, '0722222222'), mother)).statusCode).toBe(200);
    await accept(await invite(other, '0733333333'), await signup('0733333333'));

    const res = await call('GET', '/portal', undefined, mother);
    expect(res.statusCode).toBe(200);
    const children = res.json().children;
    expect(children.map((c: { fullName: string }) => c.fullName)).toEqual(['Amal', 'Bimal']);
    expect(children[0]).toMatchObject({
      outstanding: '2500.00',
      classes: [{ name: 'Theory', subjectName: 'Maths' }],
      invoices: [{ period: '2030-01', total: '2500.00', paid: '0.00' }],
    });
  });

  it('a student invite uses the student’s own mobile', async () => {
    const amal = await signup('0711111111');
    await accept(await invite(kid1, '0711111111'), amal);
    const me = (await call('GET', '', undefined, amal)).json();
    expect(me.roles).toEqual(['student']);
    expect((await call('GET', '/portal', undefined, amal)).json().children).toHaveLength(1);
  });

  it('only the student’s or a guardian’s phone can be invited', async () => {
    const res = await call('POST', `/students/${kid1}/portal-invite`, { phone: '0733333333' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unknown_phone');
  });

  it('a forwarded link is useless to another phone', async () => {
    const code = await invite(other, '0733333333');
    const stranger = await signup('0744444444');
    expect((await accept(code, stranger)).statusCode).toBe(403);
    expect((await call('GET', '/portal', undefined, stranger)).statusCode).toBe(404);
  });

  it('portal users cannot use staff pages, and are not listed as staff', async () => {
    const mother = await signup('0722222222');
    await accept(await invite(kid1, '0722222222'), mother);
    for (const url of ['/students', '/batches', `/students/${kid1}/fees`, '/fees/month']) {
      expect((await call('GET', url, undefined, mother)).statusCode).toBe(403);
    }
    expect((await call('GET', '/portal')).statusCode).toBe(403);
    const members = (await call('GET', '/members')).json().members;
    expect(members).toHaveLength(1);
    // Parent invites stay out of the staff invite list.
    await invite(kid2, '0722222222');
    expect((await call('GET', '/invites')).json().invites).toEqual([]);
  });

  it('a parent can still be invited as staff', async () => {
    const mother = await signup('0722222222');
    await accept(await invite(kid1, '0722222222'), mother);
    const res = await call('POST', '/invites', {
      fullName: 'Kamala',
      phone: '0722222222',
      role: 'teacher',
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('live class links', () => {
  const ZOOM = 'https://us02web.zoom.us/j/123456789?pwd=abc';
  let mother: string;
  let liveBatch: string;

  const session = (minutesFromNow: number) =>
    call('POST', `/batches/${liveBatch}/sessions`, {
      startsAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
      endsAt: new Date(Date.now() + (minutesFromNow + 120) * 60_000).toISOString(),
    });
  const sessions = async () =>
    (await call('GET', '/portal', undefined, mother)).json().children[0].sessions as {
      liveUrl: string | null;
      feeDue: boolean;
      online: boolean;
    }[];

  beforeEach(async () => {
    liveBatch = (
      await call('POST', '/batches', {
        name: 'Online Revision',
        subjectName: 'Maths',
        mode: 'online',
        liveUrl: ZOOM,
      })
    ).json().batch.id;
    await call('PUT', `/batches/${liveBatch}/fees`, { class: '1000' });
    await call('POST', `/batches/${liveBatch}/enrollments`, { studentIds: [kid1] });
    mother = await signup('0722222222');
    await accept(await invite(kid1, '0722222222'), mother);
  });

  it('shows the link around class time only after this month is paid', async () => {
    await session(-10);
    await call('POST', '/invoices/generate', { period: colomboToday().slice(0, 7) });
    let [now] = await sessions();
    expect(now).toMatchObject({ online: true, feeDue: true, liveUrl: null });

    const due = (await call('GET', `/students/${kid1}/fees`)).json().outstanding;
    await call('POST', '/payments', {
      studentId: kid1,
      amount: due,
      clientRef: crypto.randomUUID(),
    });
    [now] = await sessions();
    expect(now).toMatchObject({ feeDue: false, liveUrl: ZOOM });
  });

  it('never shows the link long before the class', async () => {
    await session(24 * 60);
    const [later] = await sessions();
    expect(later).toMatchObject({ online: true, liveUrl: null });
  });

  it('accepts only https links, and editing a class keeps its mode', async () => {
    const bad = await call('PATCH', `/batches/${liveBatch}`, { liveUrl: 'http://zoom.us/j/1' });
    expect(bad.statusCode).toBe(400);
    const res = await call('PATCH', `/batches/${liveBatch}`, { status: 'archived' });
    expect(res.json().batch).toMatchObject({ mode: 'online', liveUrl: ZOOM, status: 'archived' });
  });
});
