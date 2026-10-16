import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;

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
});

/** Sign up and return the session cookie header value. */
async function signup(phone: string, fullName = 'Test User') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName },
  });
  expect(res.statusCode).toBe(201);
  const sid = res.cookies.find((c) => c.name === 'sid');
  expect(sid?.httpOnly).toBe(true);
  return { cookie: `sid=${sid!.value}`, user: res.json().user };
}

async function createTenant(cookie: string, slug = 'nimal-maths') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tenants',
    headers: { cookie },
    payload: { name: 'Nimal Maths', slug },
  });
  expect(res.statusCode).toBe(201);
  return res.json().tenant as { id: string };
}

describe('auth', () => {
  it('signup normalises the phone and logs in', async () => {
    const { cookie, user } = await signup('077 123 4567');
    expect(user.phone).toBe('94771234567');
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(user.id);
  });

  it('rejects a duplicate phone', async () => {
    await signup('0771234567');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        phone: '+94771234567',
        password: 'another-pass',
        acceptPrivacy: true,
        fullName: 'X',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('phone_taken');
  });

  it('login: wrong password and unknown phone give the same 401', async () => {
    await signup('0771234567');
    for (const payload of [
      { phone: '0771234567', password: 'wrong-password' },
      { phone: '0779999999', password: 'correct-horse' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('invalid_credentials');
    }
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: '0771234567', password: 'correct-horse' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('signup requires agreeing to the privacy notice and records when', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { phone: '0771234567', password: 'correct-horse', fullName: 'Kasun' },
    });
    expect(res.statusCode).toBe(400);
    expect(await ownerDb('users').first()).toBeUndefined();
    await signup('0771234567');
    expect(
      (await ownerDb('users').first('privacy_accepted_at')).privacy_accepted_at,
    ).toBeInstanceOf(Date);
  });

  it('stores only a hash of the password and session token', async () => {
    const { cookie } = await signup('0771234567');
    const user = await ownerDb('users').first('password_hash');
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    const token = cookie.slice('sid='.length);
    expect(await ownerDb('auth_sessions').where({ token_hash: token }).first()).toBeUndefined();
  });

  it('401 without a cookie, and after logout the old cookie stops working', async () => {
    expect((await app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const { cookie } = await signup('0771234567');
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ code: 'unauthenticated', requestId: expect.any(String) });
  });

  it('validation errors use the standard error shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { phone: '0771234567', password: 'short', fullName: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'validation_error',
      requestId: expect.any(String),
      details: { password: expect.any(Array), fullName: expect.any(Array) },
    });
  });

  it('rate-limits login attempts per IP', async () => {
    const limited = await buildApp({
      db: appDb,
      secureCookies: false,
      authRateLimitMax: 2,
      logger: false,
    });
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const res = await limited.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { phone: '0771234567', password: 'x' },
      });
      codes.push(res.statusCode);
    }
    await limited.close();
    expect(codes).toEqual([401, 401, 429]);
  });
});

describe('tenants', () => {
  it('creating a tenant makes the user its owner with a Main branch', async () => {
    const { cookie } = await signup('0771234567');
    const tenant = await createTenant(cookie);

    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.json().tenants.map((t: { id: string }) => t.id)).toEqual([tenant.id]);

    const res = await app.inject({ url: `/api/v1/tenants/${tenant.id}`, headers: { cookie } });
    expect(res.json()).toMatchObject({ tenant: { slug: 'nimal-maths' }, roles: ['owner'] });

    const branches = await app.inject({
      url: `/api/v1/tenants/${tenant.id}/branches`,
      headers: { cookie },
    });
    expect(branches.json().branches.map((b: { name: string }) => b.name)).toEqual(['Main']);
  });

  it('rejects a taken slug', async () => {
    const { cookie } = await signup('0771234567');
    await createTenant(cookie);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: { cookie },
      payload: { name: 'Other', slug: 'nimal-maths' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('404 for another tenant, a random id and a malformed id', async () => {
    const a = await signup('0771111111');
    const b = await signup('0772222222');
    const tenantB = await createTenant(b.cookie, 'tenant-b');
    for (const id of [tenantB.id, crypto.randomUUID(), 'not-a-uuid']) {
      const res = await app.inject({ url: `/api/v1/tenants/${id}`, headers: { cookie: a.cookie } });
      expect(res.statusCode).toBe(404);
      const branches = await app.inject({
        url: `/api/v1/tenants/${id}/branches`,
        headers: { cookie: a.cookie },
      });
      expect(branches.statusCode).toBe(404);
    }
  });

  it('401 for tenant routes without login', async () => {
    const { cookie } = await signup('0771234567');
    const tenant = await createTenant(cookie);
    const res = await app.inject({ url: `/api/v1/tenants/${tenant.id}` });
    expect(res.statusCode).toBe(401);
  });

  it('403 when the member lacks the required role', async () => {
    const owner = await signup('0771111111');
    const tenant = await createTenant(owner.cookie);
    const student = await signup('0772222222');
    // No invite API yet: arrange a student membership directly.
    const [m] = await ownerDb('tenant_memberships')
      .insert({ tenant_id: tenant.id, user_id: student.user.id })
      .returning('id');
    await ownerDb('membership_roles').insert({
      tenant_id: tenant.id,
      membership_id: m.id,
      role: 'student',
    });

    const view = await app.inject({
      url: `/api/v1/tenants/${tenant.id}`,
      headers: { cookie: student.cookie },
    });
    expect(view.json().roles).toEqual(['student']);

    const branches = await app.inject({
      url: `/api/v1/tenants/${tenant.id}/branches`,
      headers: { cookie: student.cookie },
    });
    expect(branches.statusCode).toBe(403);
    expect(branches.json().code).toBe('forbidden');
  });

  it('a disabled membership loses access', async () => {
    const { cookie, user } = await signup('0771234567');
    const tenant = await createTenant(cookie);
    await ownerDb('tenant_memberships')
      .where({ tenant_id: tenant.id, user_id: user.id })
      .update({ status: 'disabled' });
    const res = await app.inject({ url: `/api/v1/tenants/${tenant.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
