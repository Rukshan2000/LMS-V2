import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { provision } from './provision.js';
import { addDays, colomboToday } from '../src/lib/time.js';

// Super admin console API (docs/SAAS_PLAN.md §10). Price books and settings are seeded rows that
// TRUNCATE does not reset: tests edit only a book they create, and restore any setting they change.

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let admin: string;
let adminId: string;
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

async function signup(phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return { cookie: `sid=${sid.value}`, userId: res.json().user.id as string };
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
  ({ cookie: admin, userId: adminId } = await signup('0779999999'));
  await ownerDb('users').where({ id: adminId }).update({ is_platform_admin: true });
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

  it('the docs are served to platform admins and document every console route', async () => {
    const res = await call('GET', '/docs');
    expect(res.statusCode).toBe(200);
    const pages: { slug: string; blocks: Record<string, unknown>[] }[] = res.json().pages;
    const documented = new Set(
      pages.flatMap((p) =>
        p.blocks.flatMap((b) => {
          const e = b.endpoint as { method: string; path: string } | undefined;
          return e ? [`${e.method} ${e.path}`] : [];
        }),
      ),
    );
    const route = ([method, url]: [string, string]) =>
      `${method} /api/v1/admin${url
        .split('?')[0]!
        .replaceAll(ID, ':id')
        .replace(/\/(overrides|price-books|settings)\/[^/]+$/, '/$1/:key')}`;
    expect(ROUTES.map(route).filter((r) => !documented.has(r))).toEqual([]);
    // Links between pages point at pages that exist.
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

  it('/auth/me says who is a platform admin', async () => {
    const me = (cookie: string) => call('GET', '/api/v1/auth/me', undefined, cookie);
    expect((await me(admin)).json().isPlatformAdmin).toBe(true);
    expect((await me(owner)).json().isPlatformAdmin).toBe(false);
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

  it('claiming: an account created in the console is claimed when that phone opens an institute', async () => {
    const created = await call('POST', '/accounts', {
      name: 'Saman Science',
      ownerPhone: '071 234 5678',
      priceBook: 'standard',
      trialDays: 14,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().account.id;
    const again = await call('POST', '/accounts', {
      name: 'Twice',
      ownerPhone: '0712345678',
      priceBook: 'standard',
      trialDays: 14,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('account_exists');

    const saman = await signup('0712345678');
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
    expect(detail.account).toMatchObject({ claimed: true, ownerName: 'User 0712345678' });
    expect(detail.account.daysLeft).toBe(14);
  });

  it('extending a running trial moves the trial caps with it', async () => {
    const before = await ownerDb('accounts').where({ id: accountId }).first('trial_ends_at');
    const res = await call('POST', `/accounts/${accountId}/trial`, { days: 10 });
    expect(res.statusCode).toBe(200);
    const after = await ownerDb('accounts').where({ id: accountId }).first('trial_ends_at');
    expect(after.trial_ends_at.getTime() - before.trial_ends_at.getTime()).toBe(10 * 86400_000);
    const caps = await ownerDb('account_overrides').where({ account_id: accountId });
    expect(caps.map((c) => c.expires_at.getTime())).toEqual(
      caps.map(() => after.trial_ends_at.getTime()),
    );
  });

  it('recount rewrites today from live counts and never lowers the peak', async () => {
    const today = colomboToday();
    await call('POST', `/api/v1/tenants/${tenantId}/students`, { fullName: 'Amal' }, owner);
    // A path the triggers missed: today's student row is lost, the teacher row says 4 at peak.
    await ownerDb('tenant_usage_daily').where({ tenant_id: tenantId, head: 'student' }).del();
    await usage('teacher', today, 4);
    const res = await call('POST', `/accounts/${accountId}/recount`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ day: today, counts: { student: 1, teacher: 4 } });
    const rows = await ownerDb('tenant_usage_daily')
      .where({ tenant_id: tenantId })
      .whereRaw('day = ?', [today])
      .select('head', 'count_max as max', 'count_last as last');
    expect(rows).toEqual(
      expect.arrayContaining([
        { head: 'student', max: 1, last: 1 },
        { head: 'teacher', max: 4, last: 0 },
      ]),
    );
  });

  it('suspending makes the account read-only for the customer', async () => {
    const suspend = await call('POST', `/accounts/${accountId}/suspend`, { reason: 'Unpaid' });
    expect(suspend.statusCode).toBe(204);
    const add = await call(
      'POST',
      `/api/v1/tenants/${tenantId}/students`,
      { fullName: 'Kasun' },
      owner,
    );
    expect(add.json().code).toBe('account_suspended');
    expect((await call('POST', `/accounts/${accountId}/suspend`, { reason: 'x' })).statusCode).toBe(
      409,
    );
    expect((await call('POST', `/accounts/${accountId}/unsuspend`)).statusCode).toBe(204);
  });
});

describe('overrides and invoices', () => {
  it('an override changes the next invoice but never a past one', async () => {
    await ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: null });
    await usage('student', `${lastMonth}-01`, 10);
    const generated = await call('POST', '/invoices/generate', { period: lastMonth });
    expect(generated.json().invoices).toMatchObject([{ total: '1000.00' }]);

    const set = await call('PUT', `/accounts/${accountId}/overrides/price.student`, {
      value: 80,
      note: 'Pilot discount',
    });
    expect(set.statusCode).toBe(204);
    const invoices = (await call('GET', `/invoices?period=${lastMonth}`)).json().invoices;
    expect(invoices).toMatchObject([{ total: '1000.00', status: 'open', paid: '0.00' }]);
    expect(invoices[0].lines[0]).toMatchObject({ unitPrice: '100.00' });
    // The month so far already uses the new price.
    expect((await call('GET', `/accounts/${accountId}`)).json()).toMatchObject({
      values: { price: { student: 80 } },
      month: { estimate: { total: '800.00' } },
    });

    // Void, then regenerate the month: the new invoice uses the price as it is now.
    const voided = await call('POST', `/invoices/${invoices[0].id}/void`, { reason: 'Discount' });
    expect(voided.statusCode).toBe(204);
    expect((await call('GET', `/invoices/preview?period=${lastMonth}`)).json().preview).toEqual([
      { accountId, accountName: 'Nimal Maths', total: '800.00' },
    ]);
    const again = await call('POST', '/invoices/generate', { period: lastMonth });
    expect(again.json().invoices).toMatchObject([
      { number: `S-${lastMonth}-0002`, total: '800.00' },
    ]);
    const all = await ownerDb('subscription_invoices').orderBy('number');
    expect(all.map((i) => [i.number, i.status, i.total])).toEqual([
      [`S-${lastMonth}-0001`, 'void', '1000.00'],
      [`S-${lastMonth}-0002`, 'open', '800.00'],
    ]);
  });

  it('override values are checked against the catalogue', async () => {
    const put = (key: string, body: object) =>
      call('PUT', `/accounts/${accountId}/overrides/${key}`, body);
    expect((await put('price.unicorn', { value: 1, note: 'x' })).json().code).toBe('unknown_key');
    expect((await put('price.student', { value: -1, note: 'x' })).statusCode).toBe(400);
    expect((await put('price.student', { value: 1.005, note: 'x' })).statusCode).toBe(400);
    expect((await put('feature.reports', { value: 'yes', note: 'x' })).statusCode).toBe(400);
    expect((await put('cap.students', { value: 5 })).statusCode).toBe(400); // note required
    const past = new Date(Date.now() - 1000).toISOString();
    expect((await put('cap.students', { value: 5, note: 'x', expiresAt: past })).statusCode).toBe(
      400,
    );
    expect((await put('cap.students', { value: null, note: 'No cap' })).statusCode).toBe(204);
  });

  it('records a payment once per clientRef', async () => {
    await ownerDb('accounts').where({ id: accountId }).update({ trial_ends_at: null });
    await usage('teacher', `${lastMonth}-01`, 1);
    const [invoice] = (await call('POST', '/invoices/generate', { period: lastMonth })).json()
      .invoices;
    const body = { amount: '2000', reference: 'BOC 1', clientRef: crypto.randomUUID() };
    const paid = await call('POST', `/invoices/${invoice.id}/payments`, body);
    expect(paid.json()).toMatchObject({ status: 'paid', amountDue: '0.00' });
    expect((await call('POST', `/invoices/${invoice.id}/payments`, body)).statusCode).toBe(200);
    expect(await ownerDb('subscription_payments')).toHaveLength(1);
  });
});

describe('price books and settings', () => {
  it('a price book edit rejects unknown keys and reports the accounts it affects', async () => {
    await call('POST', '/price-books', { key: 'pilot', name: 'Pilot', values: {} });
    await ownerDb('accounts').where({ id: accountId }).update({ price_book: 'pilot' });
    const bad = await call('PUT', '/price-books/pilot', { values: { 'price.unicorn': 5 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('validation_error');
    const badValue = await call('PUT', '/price-books/pilot', { values: { 'price.student': -5 } });
    expect(badValue.statusCode).toBe(400);
    expect((await ownerDb('price_books').where({ key: 'pilot' }).first()).values).toEqual({});

    const ok = await call('PUT', '/price-books/pilot', { values: { 'price.student': 75 } });
    expect(ok.json()).toEqual({ affectedAccounts: 1 });
    const books = (await call('GET', '/price-books')).json().priceBooks;
    expect(books.map((b: { key: string; accounts: number }) => [b.key, b.accounts])).toEqual([
      ['standard', 0],
      ['pilot', 1],
    ]);
    expect(
      (await call('POST', '/price-books', { key: 'pilot', name: 'x', values: {} })).statusCode,
    ).toBe(409);
  });

  it('settings are validated per key', async () => {
    const settings = (await call('GET', '/settings')).json().settings;
    expect(settings).toMatchObject({ trial_days: 30, grace_days: 7, invoice_due_days: 7 });
    const put = (key: string, value: unknown) => call('PUT', `/settings/${key}`, { value });
    expect((await put('trial_days', 0)).statusCode).toBe(400);
    expect((await put('support_whatsapp', '0771234567')).statusCode).toBe(400);
    expect((await put('trial_caps', { 'price.student': 1 })).statusCode).toBe(400);
    expect((await put('nonsense', 1)).statusCode).toBe(404);
    try {
      expect((await put('grace_days', 10)).statusCode).toBe(204);
      expect((await call('GET', '/settings')).json().settings.grace_days).toBe(10);
    } finally {
      await ownerDb('platform_settings')
        .where({ key: 'grace_days' })
        .update({ value: JSON.stringify(settings.grace_days) });
    }
  });
});

describe('audit', () => {
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
            ownerPhone: '0711111111',
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
