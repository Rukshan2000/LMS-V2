import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { emailFor, provision, sentMail, signupUser } from './provision.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;

async function signup(phone: string, fullName = `User ${phone}`) {
  await provision(ownerDb, phone);
  const res = await signupUser(app, { phone, fullName });
  const sid = res.cookies.find((c) => c.name === 'sid')!;
  return `sid=${sid.value}`;
}

const req = (method: string, url: string, cookie?: string, payload?: unknown) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: cookie ? { cookie } : {},
    payload: payload as object,
  });

async function invite(role = 'teacher', phone = '0712345678') {
  const res = await req('POST', `/api/v1/tenants/${tenantId}/invites`, owner, {
    fullName: 'Sunil Teacher',
    email: emailFor(phone),
    role,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { code: string; invite: { id: string }; emailSent: boolean };
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
  owner = await signup('0770000001');
  tenantId = (
    await req('POST', '/api/v1/tenants', owner, { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
});

describe('staff invites', () => {
  it('invitee gets the link by email, signs up with that email, accepts and gets the role', async () => {
    const { code, emailSent } = await invite('teacher');
    expect(emailSent).toBe(true);
    const mail = sentMail(app).at(-1)!;
    expect(mail.to).toBe('94712345678@test.lk');
    expect(mail.subject).toBe('Invitation to Nimal Maths');
    expect(mail.text).toContain(`/join/${code}`);
    const view = await req('GET', `/api/v1/invites/${code}`);
    expect(view.json().invite).toMatchObject({
      tenantName: 'Nimal Maths',
      role: 'teacher',
      email: '94712345678@test.lk',
    });

    const teacher = await signup('071 234 5678');
    const accept = await req('POST', `/api/v1/invites/${code}/accept`, teacher);
    expect(accept.json()).toEqual({ tenantId });

    const me = await req('GET', `/api/v1/tenants/${tenantId}`, teacher);
    expect(me.json().roles).toEqual(['teacher']);
    // Single use.
    expect((await req('GET', `/api/v1/invites/${code}`)).statusCode).toBe(404);
    expect((await req('POST', `/api/v1/invites/${code}/accept`, teacher)).statusCode).toBe(404);
  });

  it('a forwarded link cannot be used by a different email', async () => {
    const { code } = await invite();
    const stranger = await signup('0779999999');
    const res = await req('POST', `/api/v1/invites/${code}/accept`, stranger);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('wrong_email');
  });

  it('a pending invite always has an email (migration 019)', async () => {
    await invite();
    await expect(
      ownerDb('tenant_invites').update({ email: null, phone: '94712345678' }),
    ).rejects.toThrow(/tenant_invites_pending_email/);
  });

  it('resend mails a new link and the old one stops working', async () => {
    const first = await invite();
    const res = await req(
      'POST',
      `/api/v1/tenants/${tenantId}/invites/${first.invite.id}/resend`,
      owner,
    );
    expect(res.json().emailSent).toBe(true);
    expect(sentMail(app).at(-1)!.text).toContain(`/join/${res.json().code}`);
    expect((await req('GET', `/api/v1/invites/${first.code}`)).statusCode).toBe(404);
    expect((await req('GET', `/api/v1/invites/${res.json().code}`)).statusCode).toBe(200);
  });

  it('a failed email still creates the invite, so the link can be copied', async () => {
    const original = app.mailer.send;
    app.mailer.send = async () => {
      throw new Error('smtp down');
    };
    try {
      const res = await req('POST', `/api/v1/tenants/${tenantId}/invites`, owner, {
        fullName: 'X',
        email: 'x@test.lk',
        role: 'teacher',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().emailSent).toBe(false);
      expect((await req('GET', `/api/v1/invites/${res.json().code}`)).statusCode).toBe(200);
    } finally {
      app.mailer.send = original;
    }
  });

  it('accepting requires login', async () => {
    const { code } = await invite();
    expect((await req('POST', `/api/v1/invites/${code}/accept`)).statusCode).toBe(401);
  });

  it('tampered, malformed, revoked and expired links are 404', async () => {
    const { code, invite: inv } = await invite();
    const [tid, token] = code.split('.');
    const tampered = `${tid}.${token!.slice(0, -1)}${token!.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [tampered, 'nope', `${crypto.randomUUID()}.${token}`]) {
      expect((await req('GET', `/api/v1/invites/${bad}`)).statusCode).toBe(404);
    }
    await req('DELETE', `/api/v1/tenants/${tenantId}/invites/${inv.id}`, owner);
    expect((await req('GET', `/api/v1/invites/${code}`)).statusCode).toBe(404);

    const { code: c2 } = await invite('receptionist', '0723334444');
    await ownerDb('tenant_invites')
      .where({ email: emailFor('0723334444') })
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect((await req('GET', `/api/v1/invites/${c2}`)).statusCode).toBe(404);
  });

  it('re-inviting the same email replaces the old link', async () => {
    const first = await invite();
    const second = await invite('receptionist');
    expect((await req('GET', `/api/v1/invites/${first.code}`)).statusCode).toBe(404);
    expect((await req('GET', `/api/v1/invites/${second.code}`)).json().invite.role).toBe(
      'receptionist',
    );
    const list = (await req('GET', `/api/v1/tenants/${tenantId}/invites`, owner)).json().invites;
    expect(list).toHaveLength(1);
  });

  it('cannot invite someone who is already staff, or invite as owner', async () => {
    const { code } = await invite();
    const teacher = await signup('0712345678');
    await req('POST', `/api/v1/invites/${code}/accept`, teacher);
    const again = await req('POST', `/api/v1/tenants/${tenantId}/invites`, owner, {
      fullName: 'X',
      email: emailFor('0712345678'),
      role: 'admin',
    });
    expect(again.json().code).toBe('already_member');
    const asOwner = await req('POST', `/api/v1/tenants/${tenantId}/invites`, owner, {
      fullName: 'X',
      email: emailFor('0711111111'),
      role: 'owner',
    });
    expect(asOwner.statusCode).toBe(400);
  });

  it('teachers and receptionists cannot invite', async () => {
    const { code } = await invite('receptionist');
    const r = await signup('0712345678');
    await req('POST', `/api/v1/invites/${code}/accept`, r);
    const res = await req('POST', `/api/v1/tenants/${tenantId}/invites`, r, {
      fullName: 'X',
      email: emailFor('0711111111'),
      role: 'teacher',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('removing staff', () => {
  it('removed staff lose access; the owner and yourself cannot be removed', async () => {
    const { code } = await invite();
    const teacher = await signup('0712345678');
    await req('POST', `/api/v1/invites/${code}/accept`, teacher);
    const members = (await req('GET', `/api/v1/tenants/${tenantId}/members`, owner)).json().members;
    const teacherM = members.find((m: { roles: string[] }) => m.roles.includes('teacher'));
    const ownerM = members.find((m: { roles: string[] }) => m.roles.includes('owner'));

    expect(
      (
        await req('DELETE', `/api/v1/tenants/${tenantId}/members/${ownerM.membershipId}`, owner)
      ).json().code,
    ).toBe('cannot_remove_self');
    const removed = await req(
      'DELETE',
      `/api/v1/tenants/${tenantId}/members/${teacherM.membershipId}`,
      owner,
    );
    expect(removed.statusCode).toBe(200);
    expect((await req('GET', `/api/v1/tenants/${tenantId}`, teacher)).statusCode).toBe(404);

    // Re-invite brings them back.
    const { code: c2 } = await invite();
    await req('POST', `/api/v1/invites/${c2}/accept`, teacher);
    expect((await req('GET', `/api/v1/tenants/${tenantId}`, teacher)).statusCode).toBe(200);
  });
});
