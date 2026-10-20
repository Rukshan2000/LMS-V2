import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision, sentMail, signupUser } from './provision.js';
import { addDays, colomboToday } from '../src/lib/time.js';

// Super admin console API (docs/SAAS_PLAN.md §10). Price books and settings are seeded rows that
// TRUNCATE does not reset: tests edit only a book they create, and restore any setting they change.

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let admin: string;
let adminId: string;
/** The platform owner's app session from signup, before they were made the owner. */
let adminApp: string;
let owner: string;
let tenantId: string;
let accountId: string;

const ID = '00000000-0000-4000-8000-000000000000';
/** Every console route, with a valid-looking path. */
const ROUTES: [string, string][] = [
  ['GET', '/accounts'],
  ['POST', '/accounts'],
  ['GET', `/accounts/${ID}`],
  ['PATCH', `/accounts/${ID}`],
  ['PUT', `/accounts/${ID}/overrides/price.student`],
  ['DELETE', `/accounts/${ID}/overrides/price.student`],
  ['POST', `/accounts/${ID}/trial`],
  ['POST', `/accounts/${ID}/recount`],
  ['POST', `/accounts/${ID}/suspend`],
  ['POST', `/accounts/${ID}/unsuspend`],
  ['POST', `/accounts/${ID}/invite`],
  ['GET', '/invoices'],
  ['GET', '/invoices/preview?period=2026-01'],
  ['POST', '/invoices/generate'],
  ['POST', `/invoices/${ID}/payments`],
  ['POST', `/invoices/${ID}/void`],
  ['GET', '/price-books'],
  ['PUT', '/price-books/standard'],
  ['POST', '/price-books'],
  ['GET', '/settings'],
  ['PUT', '/settings/trial_days'],
  ['GET', '/audit'],
  ['GET', '/docs'],
];

async function signup(phone: string, email?: string) {
  const res = await signupUser(app, { phone, email, fullName: `User ${phone}` });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
}
async function consoleLogin(password = 'correct-horse') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/auth/login',
    payload: { email: '94779999999@test.lk', password },
  });
  const sid = res.cookies.find((c) => c.name === 'console_sid');
  return sid ? `console_sid=${sid.value}` : '';
}
const call = (method: string, url: string, payload?: unknown, cookie = admin) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `/api/v1/admin${url}`,
    headers: { cookie },
    payload: payload as object,
  });
const auditCount = async () =>
  Number((await ownerDb('platform_audit').count({ n: '*' }).first())?.n);
const usage = (head: string, day: string, n: number) =>
  ownerDb('tenant_usage_daily')
    .insert({ tenant_id: tenantId, head, day, count_max: n, count_last: n })
    .onConflict(['tenant_id', 'head', 'day'])
    .merge();
// The month before the current one: always a finished month.
const lastMonth = addDays(`${colomboToday().slice(0, 7)}-01`, -1).slice(0, 7);

beforeAll(async () => {
  appDb = createKnex(process.env.TEST_DATABASE_URL!);
  ownerDb = createKnex(process.env.TEST_MIGRATION_DATABASE_URL!);
  app = await buildApp({
    db: appDb,
    secureCookies: false,
    authRateLimitMax: 1000,
    adminRateLimitMax: 1000,
    logger: false,
  });
});
afterAll(async () => {
  await app.close();
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

beforeEach(async () => {
  await ownerDb.raw('TRUNCATE tenants, users, accounts CASCADE');
  await ownerDb('price_books').whereNot({ key: 'standard' }).del();
  ({ cookie: adminApp, userId: adminId } = await signup('0779999999'));
  await ownerDb('users').where({ id: adminId }).update({ is_platform_admin: true });
  admin = await consoleLogin();
  await provision(ownerDb, '0770000001', 'Nimal Maths');
  owner = (await signup('0770000001')).cookie;
  tenantId = (
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal' }, owner)
  ).json().tenant.id;
  accountId = (await ownerDb('tenants').where({ id: tenantId }).first('account_id')).account_id;
});

describe('access', () => {
  it('non-admins and anonymous callers get 404 on every admin route', async () => {
    for (const [method, url] of ROUTES) {
      for (const cookie of [owner, '']) {
        const res = await call(method, url, {}, cookie);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json()).toMatchObject({ code: 'not_found', message: 'Not found' });
      }
    }
    expect(await auditCount()).toBe(0);
  });

  it('the docs are served to platform admins, and links between pages resolve', async () => {
    const res = await call('GET', '/docs');
    expect(res.statusCode).toBe(200);
    const pages: { slug: string }[] = res.json().pages;
    const slugs = new Set(pages.map((p) => p.slug));
    const links = JSON.stringify(pages).match(/\(docs:[a-z-]+\)/g) ?? [];
    expect(links.map((l) => l.slice(6, -1)).filter((l) => !slugs.has(l))).toEqual([]);
  });

  it('an admin login older than 12 hours is refused until they log in again', async () => {
    expect((await call('GET', '/accounts')).statusCode).toBe(200);
    await ownerDb('auth_sessions')
      .where({ user_id: adminId })
      .update({ created_at: new Date(Date.now() - 12 * 3600_000 - 60_000) });
    const res = await call('GET', '/accounts');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('reauth_required');
    expect((await call('POST', `/accounts/${accountId}/trial`, { days: 5 })).statusCode).toBe(401);
  });

  it('changes have a stricter rate limit; non-admins still only see 404', async () => {
    const strict = await buildApp({
      db: appDb,
      secureCookies: false,
      adminRateLimitMax: 2,
      logger: false,
    });
    try {
      const trial = (cookie: string) =>
        strict.inject({
          method: 'POST',
          url: `/api/v1/admin/accounts/${accountId}/trial`,
          headers: { cookie },
          payload: { days: 1 },
        });
      expect([(await trial(owner)).statusCode, (await trial(owner)).statusCode]).toEqual([
        404, 404,
      ]);
      expect((await trial(owner)).statusCode).toBe(404);
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await trial(admin)).statusCode);
      expect(codes).toEqual([200, 200, 429]);
      // Reads are not limited.
      const read = await strict.inject({
        url: '/api/v1/admin/settings',
        headers: { cookie: admin },
      });
      expect(read.statusCode).toBe(200);
    } finally {
      await strict.close();
    }
  });

  it('the platform owner has a separate login that works only on the console', async () => {
    // Console login: wrong password and institute owners are refused alike.
    expect(await consoleLogin('wrong-password')).toBe('');
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { email: '94770000001@test.lk', password: 'correct-horse' },
    });
    expect(ownerLogin.statusCode).toBe(401);
    expect((await call('GET', '/auth/me')).json().user.id).toBe(adminId);
    // The app login refuses the platform owner, and the console cookie means nothing to the app.
    const appLogin = await call('POST', '/api/v1/auth/login', {
      identifier: '94779999999@test.lk',
      password: 'correct-horse',
    });
    expect(appLogin.statusCode).toBe(401);
    expect((await call('GET', '/api/v1/auth/me')).statusCode).toBe(401);
    // Their app session from before does not reach the console or the app.
    expect((await call('GET', '/accounts', undefined, adminApp)).statusCode).toBe(404);
    expect((await call('GET', '/api/v1/auth/me', undefined, adminApp)).statusCode).toBe(401);
    // Logout ends the console session.
    expect((await call('POST', '/auth/logout')).statusCode).toBe(204);
    expect((await call('GET', '/accounts')).statusCode).toBe(404);
  });

  it('there is only one platform owner', async () => {
    const other = (await signup('0779999997')).userId;
    await expect(
      ownerDb('users').where({ id: other }).update({ is_platform_admin: true }),
    ).rejects.toThrow(/users_single_platform_admin/);
  });
});

describe('accounts', () => {
  it('lists accounts with state, heads now and the month-so-far estimate', async () => {
    await ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: null });
    // Today's row (written as 0 by the trigger when the institute was created) says 12.
    await usage('student', colomboToday(), 12);
    const res = await call('GET', '/accounts');
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual([
      expect.objectContaining({
        id: accountId,
        name: 'Nimal Maths',
        ownerEmail: '94770000001@test.lk',
        ownerPhone: '94770000001',
        ownerName: 'User 0770000001',
        state: 'active',
        institutes: 1,
        headsNow: expect.objectContaining({ student: 12 }),
        estimate: '1200.00',
        amountDue: '0.00',
      }),
    ]);
    expect((await call('GET', '/accounts?state=trial')).json().accounts).toEqual([]);
    expect((await call('GET', '/accounts?q=nimal')).json().accounts).toHaveLength(1);
    expect((await call('GET', '/accounts?q=0770000001')).json().accounts).toHaveLength(1);
    expect((await call('GET', '/accounts?q=@test.lk')).json().accounts).toHaveLength(1);
    expect(res.json().unverifiedUsers).toBe(0);
    expect((await call('GET', '/accounts?q=nobody')).json().accounts).toEqual([]);
  });

  it('the detail shows metadata only, never student records', async () => {
    await call('POST', `/api/v1/tenants/${tenantId}/students`, { fullName: 'Kasun Perera' }, owner);
    const res = await call('GET', `/accounts/${accountId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      account: { id: accountId, state: 'trial' },
      book: { key: 'standard' },
      institutes: [{ id: tenantId, name: 'Nimal Maths' }],
      month: { headsNow: { student: 1 } },
    });
    expect(res.json().overrides.map((o: { key: string }) => o.key)).toContain('cap.students');
    expect(res.body).not.toContain('Kasun');
    expect((await call('GET', `/accounts/${ID}`)).statusCode).toBe(404);
  });

  it('claiming: the owner gets an email and claims the account with that verified email', async () => {
    const created = await call('POST', '/accounts', {
      name: 'Saman Science',
      ownerEmail: ' Saman@Example.com ',
      ownerPhone: '071 234 5678',
      priceBook: 'standard',
      trialDays: 14,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      account: { ownerEmail: 'saman@example.com', ownerPhone: '94712345678' },
      emailSent: true,
    });
    const mail = sentMail(app).at(-1)!;
    expect(mail).toMatchObject({
      to: 'saman@example.com',
      subject: 'Your institute account is ready',
    });
    expect(mail.text).toContain('/signup?email=saman%40example.com');
    const id = created.json().account.id;
    const again = await call('POST', '/accounts', {
      name: 'Twice',
      ownerEmail: 'SAMAN@example.com',
      priceBook: 'standard',
      trialDays: 14,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('account_exists');
    expect((await call('POST', `/accounts/${id}/invite`)).json()).toEqual({ emailSent: true });

    // Same phone, other email: the phone is contact data, not proof of who owns the account.
    const impostor = await signup('0712345678', 'other@example.com');
    const refused = await call(
      'POST',
      '/api/v1/tenants',
      { name: 'X', slug: 'xxx' },
      impostor.cookie,
    );
    expect(refused.json().code).toBe('no_account');

    const saman = await signup('0713333333', 'saman@example.com');
    const tenant = await call(
      'POST',
      '/api/v1/tenants',
      { name: 'S', slug: 'saman' },
      saman.cookie,
    );
    expect(tenant.statusCode).toBe(201);
    expect(
      await ownerDb('tenants').where({ id: tenant.json().tenant.id }).first('account_id'),
    ).toEqual({ account_id: id });
    const detail = (await call('GET', `/accounts/${id}`)).json();
    expect(detail.account).toMatchObject({ claimed: true, ownerName: 'User 0713333333' });
    expect(detail.account.daysLeft).toBe(14);
    expect((await call('POST', `/accounts/${id}/invite`)).json().code).toBe('already_claimed');
  });

  it('an unclaimed account made before email login gets an owner email, then can be claimed', async () => {
    const [old] = await ownerDb('accounts')
      .insert({ name: 'Old', owner_phone: '94715555555', price_book: 'standard' })
      .returning('id');
    const patch = (body: object) => call('PATCH', `/accounts/${old.id}`, body);
    expect((await patch({ ownerEmail: '94770000001@test.lk' })).json().code).toBe('account_exists');
    expect((await patch({ ownerEmail: 'Old@Example.com' })).statusCode).toBe(204);
    expect((await call('GET', `/accounts/${old.id}`)).json().account.ownerEmail).toBe(
      'old@example.com',
    );
    const user = await signup('0716666666', 'old@example.com');
    expect(
      (await call('POST', '/api/v1/tenants', { name: 'Old', slug: 'old-one' }, user.cookie))
        .statusCode,
    ).toBe(201);
    expect((await patch({ ownerEmail: 'x@example.com' })).json().code).toBe('already_claimed');
  });

  it('every mutation writes exactly one audit row, with actor, before, after and IP', async () => {
    await ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: null });
    await usage('teacher', `${lastMonth}-01`, 1);
    const grace = (await ownerDb('platform_settings').where({ key: 'grace_days' }).first()).value;
    let invoiceId = '';
    const mutations: [string, () => Promise<{ statusCode: number }>][] = [
      [
        'account.create',
        () =>
          call('POST', '/accounts', {
            name: 'New',
            ownerEmail: 'new@example.com',
            priceBook: 'standard',
            trialDays: 0,
          }),
      ],
      ['account.update', () => call('PATCH', `/accounts/${accountId}`, { notes: 'Called' })],
      [
        'override.set',
        () =>
          call('PUT', `/accounts/${accountId}/overrides/included.student`, { value: 5, note: 'x' }),
      ],
      ['override.clear', () => call('DELETE', `/accounts/${accountId}/overrides/included.student`)],
      ['account.trial', () => call('POST', `/accounts/${accountId}/trial`, { days: 3 })],
      ['account.recount', () => call('POST', `/accounts/${accountId}/recount`)],
      ['account.suspend', () => call('POST', `/accounts/${accountId}/suspend`, { reason: 'x' })],
      ['account.unsuspend', () => call('POST', `/accounts/${accountId}/unsuspend`)],
      [
        'price_book.create',
        () => call('POST', '/price-books', { key: 'audit-book', name: 'A', values: {} }),
      ],
      [
        'price_book.update',
        () => call('PUT', '/price-books/audit-book', { values: { 'price.student': 1 } }),
      ],
      ['setting.update', () => call('PUT', '/settings/grace_days', { value: grace })],
      [
        'invoice.generate',
        async () => {
          // The trial just extended above would make the month free: end it again.
          await ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: null });
          const res = await call('POST', '/invoices/generate', { period: lastMonth });
          invoiceId = res.json().invoices[0].id;
          return res;
        },
      ],
      [
        'invoice.payment',
        () =>
          call('POST', `/invoices/${invoiceId}/payments`, {
            amount: '1',
            reference: 'r',
            clientRef: crypto.randomUUID(),
          }),
      ],
    ];
    for (const [action, run] of mutations) {
      const before = await auditCount();
      const res = await run();
      expect(res.statusCode, action).toBeLessThan(300);
      const rows = await ownerDb('platform_audit').where('id', '>', 0).orderBy('id').offset(before);
      expect(rows, action).toHaveLength(1);
      expect(rows[0], action).toMatchObject({ action, actor_user_id: adminId, ip: '127.0.0.1' });
      expect(rows[0].after, action).not.toBeNull();
    }
    // The paid invoice cannot be voided (refused, no row); one without payments can.
    const other = (await call('GET', '/accounts?q=New')).json().accounts[0].id;
    expect(other).toBeDefined();
    const before = await auditCount();
    await ownerDb('subscription_invoices').insert({
      account_id: other,
      number: 'S-TEST-0001',
      period: lastMonth,
      lines: '[]',
      total: '1.00',
      due_date: colomboToday(),
    });
    expect((await call('POST', `/invoices/${invoiceId}/void`, { reason: 'x' })).statusCode).toBe(
      409,
    );
    const voidable = await ownerDb('subscription_invoices')
      .where({ number: 'S-TEST-0001' })
      .first();
    expect((await call('POST', `/invoices/${voidable.id}/void`, { reason: 'x' })).statusCode).toBe(
      204,
    );
    expect(await auditCount()).toBe(before + 1);

    // A refused change writes nothing.
    const refused = await auditCount();
    await call('PUT', '/price-books/audit-book', { values: { nope: 1 } });
    await call('POST', `/accounts/${accountId}/unsuspend`);
    expect(await auditCount()).toBe(refused);

    const log = (await call('GET', `/audit?accountId=${accountId}`)).json().events;
    expect(log[0]).toMatchObject({ action: 'invoice.payment', actor: 'User 0779999999' });
    expect(log.every((e: { accountId: string }) => e.accountId === accountId)).toBe(true);
  });
});
