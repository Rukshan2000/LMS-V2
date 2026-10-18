import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/modules/identity/service.js';
import { lastCode, provision, sentMail, signupUser } from './provision.js';

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
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName });
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

const post = (url: string, payload: object, cookie?: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    payload,
    headers: cookie ? { cookie } : {},
  });
const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;

describe('auth', () => {
  it('signup: the code mailed to the email creates a verified user and logs in', async () => {
    const { cookie, user } = await signup('077 123 4567');
    expect(user).toMatchObject({
      email: '94771234567@test.lk',
      emailVerified: true,
      phone: '94771234567',
    });
    const mail = sentMail(app).at(-1)!;
    expect(mail.subject).toMatch(/^\d{6} is your verification code$/);
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ id: user.id, email: '94771234567@test.lk' });
  });

  it('signup without a phone works; the phone is optional contact data', async () => {
    const res = await signupUser(app, { email: 'nophone@test.lk' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'nophone@test.lk', phone: null });
  });

  it('a registered email (any case) gets "already registered" instead of a code, same 202', async () => {
    await signup('0771234567');
    await ownerDb('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
    const start = await post('/signup/start', { email: '94771234567@TEST.lk' });
    expect(start.statusCode).toBe(202);
    expect(sentMail(app).at(-1)).toMatchObject({
      to: '94771234567@test.lk',
      subject: 'You already have an account',
    });
    expect(lastCode(app, '94771234567@test.lk')).toBe('');
    // The database also refuses a second user with the same email in another case.
    await expect(
      ownerDb('users').insert({ email: '94771234567@Test.LK', full_name: 'X', password_hash: 'x' }),
    ).rejects.toThrow(/users_email_unique/);
  });

  it('rejects a phone already on another user', async () => {
    await signup('0771234567');
    const res = await signupUser(app, { email: 'other@test.lk', phone: '+94771234567' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('phone_taken');
  });

  it('codes: wrong, reused, other-purpose and expired codes fail; 5 wrong tries kill it', async () => {
    const email = 'kasun@test.lk';
    const details = { email, password: 'correct-horse', fullName: 'Kasun', acceptPrivacy: true };
    await post('/signup/start', { email });
    const code = lastCode(app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await post('/signup/verify', { ...details, code: wrong })).json().code).toBe(
        'otp_invalid',
      );
    }
    // The right code no longer works after 5 wrong tries.
    expect((await post('/signup/verify', { ...details, code })).statusCode).toBe(400);
    expect(await ownerDb('users').first()).toBeUndefined();

    // Too soon for another code; once allowed, an expired code still fails.
    expect((await post('/signup/start', { email })).json().code).toBe('otp_too_soon');
    await ownerDb('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
    await post('/signup/start', { email });
    const fresh = lastCode(app, email);
    await ownerDb('email_otps')
      .whereNull('consumed_at')
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect((await post('/signup/verify', { ...details, code: fresh })).statusCode).toBe(400);

    // A signup code cannot reset a password, and a used code cannot be used again.
    await ownerDb('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
    await post('/signup/start', { email });
    const good = lastCode(app, email);
    expect(
      (await post('/password/reset', { email, code: good, password: 'new-password' })).statusCode,
    ).toBe(400);
    expect((await post('/signup/verify', { ...details, code: good })).statusCode).toBe(201);
    expect((await post('/signup/verify', { ...details, code: good })).statusCode).toBe(400);
  });

  it('only 5 codes per email per hour', async () => {
    for (let i = 0; i < 5; i++) {
      await ownerDb('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
      expect((await post('/signup/start', { email: 'a@test.lk' })).statusCode).toBe(202);
    }
    await ownerDb('email_otps').update({ created_at: new Date(Date.now() - 120_000) });
    expect((await post('/signup/start', { email: 'a@test.lk' })).json().code).toBe('otp_limit');
  });

  it('503 when the code cannot be mailed', async () => {
    const original = app.mailer.send;
    app.mailer.send = async () => {
      throw new Error('smtp down');
    };
    try {
      const res = await post('/signup/start', { email: 'a@test.lk' });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('mail_unavailable');
    } finally {
      app.mailer.send = original;
    }
  });

  it('login: wrong password and unknown email give the same 401; email case is ignored', async () => {
    await signup('0771234567');
    for (const payload of [
      { identifier: '94771234567@test.lk', password: 'wrong-password' },
      { identifier: 'nobody@test.lk', password: 'correct-horse' },
      // Users with a verified email cannot log in by phone.
      { identifier: '0771234567', password: 'correct-horse' },
    ]) {
      const res = await post('/login', payload);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('invalid_credentials');
    }
    const ok = await post('/login', {
      identifier: '94771234567@Test.LK',
      password: 'correct-horse',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('signup requires agreeing to the privacy notice and records when', async () => {
    await post('/signup/start', { email: 'kasun@test.lk' });
    const res = await post('/signup/verify', {
      email: 'kasun@test.lk',
      code: lastCode(app, 'kasun@test.lk'),
      password: 'correct-horse',
      fullName: 'Kasun',
    });
    expect(res.statusCode).toBe(400);
    expect(await ownerDb('users').first()).toBeUndefined();
    await signup('0771234567');
    expect(
      (await ownerDb('users').first('privacy_accepted_at')).privacy_accepted_at,
    ).toBeInstanceOf(Date);
  });

  it('forgot password: same 202 for anyone; the code resets it and logs out everywhere', async () => {
    const { cookie: old } = await signup('0771234567');
    const email = '94771234567@test.lk';
    const before = sentMail(app).length;
    expect((await post('/password/forgot', { email: 'nobody@test.lk' })).statusCode).toBe(202);
    expect(sentMail(app).length).toBe(before);
    expect((await post('/password/forgot', { email })).statusCode).toBe(202);
    const code = lastCode(app, email);
    const res = await post('/password/reset', { email, code, password: 'new-password' });
    expect(res.statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: old } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/auth/me', headers: { cookie: cookieOf(res) } })).statusCode,
    ).toBe(200);
    expect(
      (await post('/login', { identifier: email, password: 'correct-horse' })).statusCode,
    ).toBe(401);
    expect((await post('/login', { identifier: email, password: 'new-password' })).statusCode).toBe(
      200,
    );
  });

  it('change email: needs the password, a code at the new address, and tells the old one', async () => {
    const { cookie } = await signup('0771234567');
    const old = '94771234567@test.lk';
    expect(
      (await post('/email/change', { email: 'new@test.lk', password: 'nope' }, cookie)).statusCode,
    ).toBe(401);
    expect(
      (await post('/email/change', { email: 'new@test.lk', password: 'correct-horse' }, cookie))
        .statusCode,
    ).toBe(202);
    const confirm = await post(
      '/email/confirm',
      { email: 'new@test.lk', code: lastCode(app, 'new@test.lk') },
      cookie,
    );
    expect(confirm.json().user).toMatchObject({ email: 'new@test.lk', emailVerified: true });
    expect(sentMail(app).at(-1)).toMatchObject({
      to: old,
      subject: 'Your login email was changed',
    });
    expect(
      (await post('/login', { identifier: 'new@test.lk', password: 'correct-horse' })).statusCode,
    ).toBe(200);
    // Someone else's email cannot be taken.
    await signupUser(app, { email: 'taken@test.lk' });
    expect(
      (
        await post('/email/change', { email: 'taken@test.lk', password: 'correct-horse' }, cookie)
      ).json().code,
    ).toBe('email_taken');
  });

  it('a user from before email login logs in by phone, adds an email, then phone login stops', async () => {
    await ownerDb('users').insert({
      phone: '94771234567',
      full_name: 'Old User',
      password_hash: await hashPassword('correct-horse'),
    });
    const login = await post('/login', { identifier: '077 123 4567', password: 'correct-horse' });
    expect(login.json().user).toMatchObject({ email: null, emailVerified: false });
    const cookie = cookieOf(login);
    // No password needed: there is no verified email to protect yet.
    expect((await post('/email/change', { email: 'old@test.lk' }, cookie)).statusCode).toBe(202);
    await post(
      '/email/confirm',
      { email: 'old@test.lk', code: lastCode(app, 'old@test.lk') },
      cookie,
    );
    expect(
      (await post('/login', { identifier: '0771234567', password: 'correct-horse' })).statusCode,
    ).toBe(401);
    expect(
      (await post('/login', { identifier: 'old@test.lk', password: 'correct-horse' })).statusCode,
    ).toBe(200);
  });

  it('stores only hashes of the password, session token and codes', async () => {
    const { cookie } = await signup('0771234567');
    const user = await ownerDb('users').first('password_hash');
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    const token = cookie.slice('sid='.length);
    expect(await ownerDb('auth_sessions').where({ token_hash: token }).first()).toBeUndefined();
    const otp = await ownerDb('email_otps').first('code_hash');
    expect(otp.code_hash).toMatch(/^[0-9a-f]{64}$/);
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
    const res = await post('/signup/verify', {
      email: 'a@test.lk',
      code: '123456',
      password: 'short',
      fullName: '',
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
        payload: { identifier: 'a@test.lk', password: 'x' },
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
    await createTenant((await signup('0771234567')).cookie);
    // Another customer: a second institute of the same trial account would hit the institute cap first.
    const { cookie } = await signup('0771234568');
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
