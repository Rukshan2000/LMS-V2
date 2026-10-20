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

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName: `User ${phone}` });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
}
const call = (method: string, url: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method: method as 'GET',
    url: `/api/v1${url}`,
    headers: cookie ? { cookie } : {},
    payload: payload as object,
  });
const t = (url: string) => `/tenants/${tenantId}${url}`;
const publicPage = () => call('GET', '/public/institutes/nimal-maths');

const page = (over: Record<string, unknown> = {}) => ({
  published: true,
  tagline: 'A/L Combined Maths',
  about: 'Classes in Colombo and online.',
  phone: '077 123 4567',
  whatsapp: '0771234567',
  email: '',
  address: 'Colombo 07',
  mapUrl: 'https://maps.google.com/?q=colombo',
  facebookUrl: '',
  youtubeUrl: null,
  tiktokUrl: null,
  showFees: true,
  batchIds: [],
  ...over,
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
    await call('POST', '/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' }, owner)
  ).json().tenant.id;
});

describe('public institute page', () => {
  it('is hidden until published, then shows only the marked classes', async () => {
    expect((await publicPage()).statusCode).toBe(404);
    expect((await call('GET', t('/page'), undefined, owner)).json().page.published).toBe(false);

    const shown = (
      await call('POST', t('/batches'), { name: 'Theory 2027', subjectName: 'Maths' }, owner)
    ).json().batch.id;
    await call('POST', t('/batches'), { name: 'Private', subjectName: 'Maths' }, owner);
    await call(
      'POST',
      t(`/batches/${shown}/schedule`),
      { weekday: 6, startTime: '14:00', endTime: '17:00' },
      owner,
    );
    await call('PUT', t(`/batches/${shown}/fees`), { class: '2500', ac: 0 }, owner);

    // Saved as a draft: still not public.
    const draft = await call(
      'PUT',
      t('/page'),
      page({ published: false, batchIds: [shown] }),
      owner,
    );
    expect(draft.statusCode).toBe(200);
    expect(draft.json().page).toMatchObject({
      phone: '94771234567',
      email: null,
      facebookUrl: null,
    });
    expect((await publicPage()).statusCode).toBe(404);

    await call('PUT', t('/page'), page({ batchIds: [shown] }), owner);
    const res = await publicPage();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.institute).toEqual({ slug: 'nimal-maths', name: 'Nimal Maths', theme: 'blue' });
    expect(body.page).toMatchObject({ tagline: 'A/L Combined Maths', whatsapp: '94771234567' });
    expect(body.page.published).toBeUndefined();
    expect(body.classes).toEqual([
      {
        name: 'Theory 2027',
        mode: 'physical',
        subject: 'Maths',
        teacherName: null,
        schedule: [{ weekday: 6, startTime: '14:00', endTime: '17:00' }],
        fees: [{ kind: 'class', amount: '2500.00' }],
      },
    ]);

    // Fees can be hidden; unmarking a class takes it off.
    await call('PUT', t('/page'), page({ showFees: false, batchIds: [shown] }), owner);
    expect((await publicPage()).json().classes[0].fees).toEqual([]);
    await call('PUT', t('/page'), page({ batchIds: [] }), owner);
    expect((await publicPage()).json().classes).toEqual([]);
  });

  it('suspended institutes and unknown slugs are 404', async () => {
    await call('PUT', t('/page'), page(), owner);
    expect((await publicPage()).statusCode).toBe(200);
    await ownerDb('tenants').where({ id: tenantId }).update({ status: 'suspended' });
    expect((await publicPage()).statusCode).toBe(404);
    expect((await call('GET', '/public/institutes/nobody-here')).statusCode).toBe(404);
    expect((await call('GET', '/public/institutes/..%2Fx')).statusCode).toBe(404);
  });

  it('only owners and admins edit it; bad input is refused', async () => {
    const teacher = await signup('0770000002');
    const [m] = await ownerDb('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: teacher.userId })
      .returning('id');
    await ownerDb('membership_roles').insert({
      tenant_id: tenantId,
      membership_id: m.id,
      role: 'teacher',
    });
    expect((await call('GET', t('/page'), undefined, teacher.cookie)).statusCode).toBe(403);
    expect((await call('PUT', t('/page'), page(), teacher.cookie)).statusCode).toBe(403);

    expect((await call('PUT', t('/page'), page({ mapUrl: 'http://x.lk' }), owner)).statusCode).toBe(
      400,
    );
    expect(
      (await call('PUT', t('/page'), page({ mapUrl: 'javascript:alert(1)' }), owner)).statusCode,
    ).toBe(400);
    expect((await call('PUT', t('/page'), page({ whatsapp: '123' }), owner)).statusCode).toBe(400);
  });

  it("another institute's classes cannot be put on the page", async () => {
    const other = await signup('0770000003');
    const otherTenant = (
      await call('POST', '/tenants', { name: 'Other', slug: 'other-inst' }, other.cookie)
    ).json().tenant.id;
    const foreign = (
      await call(
        'POST',
        `/tenants/${otherTenant}/batches`,
        { name: 'Theirs', subjectName: 'Bio' },
        other.cookie,
      )
    ).json().batch.id;
    await call('PUT', t('/page'), page({ batchIds: [foreign] }), owner);
    expect((await publicPage()).json().classes).toEqual([]);
    const theirs = await ownerDb('batches').where({ id: foreign }).first('on_page');
    expect(theirs.on_page).toBe(false);
  });
});
