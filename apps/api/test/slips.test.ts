import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let parent: string;
let tenantId: string;
let api: string;
let kid: string, other: string;

// A valid PNG header + some bytes; enough for the type check.
const png = (seed = 'a') =>
  `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(seed)]).toString('base64')}`;

async function signup(phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
  return `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
async function student(fullName: string, guardianPhone: string) {
  return (
    await call('POST', '/students', {
      fullName,
      guardians: [{ fullName: 'Kamala', phone: guardianPhone, relationship: 'mother' }],
    })
  ).json().student.id as string;
}
const upload = (fields: Record<string, unknown> = {}, cookie = parent) =>
  call(
    'POST',
    '/portal/slips',
    { studentId: kid, amount: '2500', file: png(), clientRef: crypto.randomUUID(), ...fields },
    cookie,
  );
const pending = async () => (await call('GET', '/slips')).json().slips;
const invoice = async () => (await call('GET', `/students/${kid}/fees`)).json().invoices[0];

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
  kid = await student('Amal', '0722222222');
  other = await student('Chamal', '0733333333');
  const batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json()
    .batch.id;
  await call('PUT', `/batches/${batchId}/fees`, { class: '2500' });
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [kid, other] });
  await call('POST', '/invoices/generate', { period: '2030-01' });
  parent = await signup('0722222222');
  const code = (
    await call('POST', `/students/${kid}/portal-invite`, { phone: '0722222222' })
  ).json().code;
  await call('POST', `/api/v1/invites/${code}/accept`, undefined, parent);
});

describe('bank slips', () => {
  it('parent uploads, desk verifies: invoice paid, receipt issued, portal updated', async () => {
    const up = await upload({ reference: 'BOC-123' });
    expect(up.statusCode).toBe(201);
    const [slip] = await pending();
    expect(slip).toMatchObject({
      studentName: 'Amal',
      amount: '2500.00',
      reference: 'BOC-123',
      outstanding: '2500.00',
      duplicateFile: false,
      duplicateReference: false,
      receiptNumber: null,
    });
    const file = await call('GET', `/slips/${slip.id}/file`);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const res = await call('POST', `/slips/${slip.id}/verify`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().receipt).toMatchObject({ receiptNumber: '1', status: 'verified' });
    expect(await invoice()).toMatchObject({ status: 'paid', paid: '2500.00' });
    expect(await pending()).toEqual([]);
    const portal = (await call('GET', '/portal', undefined, parent)).json().children[0];
    expect(portal).toMatchObject({ outstanding: '0.00', slips: [] });
    expect(portal.payments).toHaveLength(1);
  });

  it('rejecting keeps the invoice unpaid, uses no receipt number, and tells the parent why', async () => {
    await upload();
    const [slip] = await pending();
    expect(
      (await call('POST', `/slips/${slip.id}/reject`, { note: 'Slip not readable' })).statusCode,
    ).toBe(200);
    expect(await invoice()).toMatchObject({ status: 'issued', paid: '0.00' });
    const portal = (await call('GET', '/portal', undefined, parent)).json().children[0];
    expect(portal.slips).toMatchObject([{ status: 'rejected', reviewNote: 'Slip not readable' }]);
    const cash = await call('POST', '/payments', {
      studentId: kid,
      amount: '100',
      clientRef: crypto.randomUUID(),
    });
    expect(cash.json().receipt.receiptNumber).toBe('1');
  });

  it('flags the same file or the same bank reference uploaded again', async () => {
    await upload({ amount: '1000', reference: 'ref-9', file: png('same') });
    await upload({ amount: '1000', reference: 'REF-9', file: png('same') });
    const slips = await pending();
    expect(slips).toHaveLength(2);
    for (const s of slips) {
      expect(s).toMatchObject({ duplicateFile: true, duplicateReference: true });
    }
  });

  it('a double-tapped upload is recorded once', async () => {
    const clientRef = crypto.randomUUID();
    expect((await upload({ clientRef })).statusCode).toBe(201);
    expect((await upload({ clientRef })).statusCode).toBe(200);
    expect(await pending()).toHaveLength(1);
  });

  it('rejects files that are not images/PDF, whatever they claim to be', async () => {
    const html = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    const res = await upload({ file: html });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_file');
  });

  it('another institute cannot see, open or verify our slips', async () => {
    await upload();
    const [slip] = await pending();
    const other = await signup('0790000009');
    const otherTenant = (
      await call('POST', '/api/v1/tenants', { name: 'Other', slug: 'other-inst' }, other)
    ).json().tenant.id;
    const there = `/api/v1/tenants/${otherTenant}`;
    expect((await call('GET', `${there}/slips`, undefined, other)).json().slips).toEqual([]);
    expect((await call('GET', `${there}/slips/${slip.id}/file`, undefined, other)).statusCode).toBe(
      404,
    );
    expect((await call('POST', `${there}/slips/${slip.id}/verify`, {}, other)).statusCode).toBe(
      404,
    );
    // And our own URL with their cookie: not a member here.
    expect((await call('GET', `/slips/${slip.id}/file`, undefined, other)).statusCode).toBe(404);
  });

  it('parents upload only for their own children and cannot review', async () => {
    expect((await upload({ studentId: other })).statusCode).toBe(404);
    await upload();
    const [slip] = await pending();
    expect((await call('GET', '/slips', undefined, parent)).statusCode).toBe(403);
    expect((await call('GET', `/slips/${slip.id}/file`, undefined, parent)).statusCode).toBe(403);
    expect((await call('POST', `/slips/${slip.id}/verify`, {}, parent)).statusCode).toBe(403);
    expect((await upload({}, owner)).statusCode).toBe(403);
  });

  it('a slip for more than is due cannot be verified as-is; the amount can be corrected', async () => {
    await upload({ amount: '3000' });
    const [slip] = await pending();
    const res = await call('POST', `/slips/${slip.id}/verify`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('overpayment');
    expect(await pending()).toHaveLength(1);
    const fixed = await call('POST', `/slips/${slip.id}/verify`, { amount: '2500' });
    expect(fixed.json().receipt).toMatchObject({ amount: '2500.00', receiptNumber: '1' });
  });

  it('two staff verifying the same slip at once allocate it only once', async () => {
    await upload({ amount: '1000' });
    const [slip] = await pending();
    const results = await Promise.all(
      [1, 2, 3].map(() => call('POST', `/slips/${slip.id}/verify`, {})),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404, 404]);
    expect(await invoice()).toMatchObject({ paid: '1000.00', status: 'part_paid' });
  });
});
