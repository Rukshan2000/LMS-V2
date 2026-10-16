import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, withUser } from '../src/context.js';
import { app, owner } from './db.js';

let ownerDb: Knex;
let appDb: Knex;
let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;

beforeAll(() => {
  ownerDb = owner();
  appDb = app();
});

afterAll(async () => {
  await Promise.all([ownerDb.destroy(), appDb.destroy()]);
});

beforeEach(async () => {
  await ownerDb.raw('TRUNCATE tenants, users CASCADE');
  [tenantA, tenantB] = (
    await ownerDb('tenants')
      .insert([
        { slug: 'tenant-a', name: 'A' },
        { slug: 'tenant-b', name: 'B' },
      ])
      .returning('id')
  ).map((r) => r.id);
  [userA, userB] = (
    await ownerDb('users')
      .insert([
        { phone: '94770000001', full_name: 'User A', password_hash: 'x' },
        { phone: '94770000002', full_name: 'User B', password_hash: 'x' },
      ])
      .returning('id')
  ).map((r) => r.id);
  await ownerDb('branches').insert([
    { tenant_id: tenantA, name: 'A main' },
    { tenant_id: tenantB, name: 'B main' },
  ]);
  await ownerDb('tenant_memberships').insert([
    { tenant_id: tenantA, user_id: userA },
    { tenant_id: tenantB, user_id: userA },
    { tenant_id: tenantB, user_id: userB },
  ]);
});

describe('tenant isolation (RLS)', () => {
  it('tenant A cannot see tenant B rows', async () => {
    const rows = await withTenant(appDb, { tenantId: tenantA }, (trx) => trx('branches'));
    expect(rows.map((r) => r.name)).toEqual(['A main']);
  });

  it('no tenant context returns nothing', async () => {
    expect(await appDb('branches')).toHaveLength(0);
    expect(await appDb('tenant_memberships')).toHaveLength(0);
  });

  it('context does not leak to the next query on the same pooled connection', async () => {
    await withTenant(appDb, { tenantId: tenantA }, (trx) => trx('branches'));
    expect(await appDb('branches')).toHaveLength(0);
  });

  it('cannot insert a row for another tenant', async () => {
    await expect(
      withTenant(appDb, { tenantId: tenantA }, (trx) =>
        trx('branches').insert({ tenant_id: tenantB, name: 'sneaky' }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another tenant's rows by id", async () => {
    const [bBranch] = await ownerDb('branches').where({ tenant_id: tenantB });
    const result = await withTenant(appDb, { tenantId: tenantA }, async (trx) => ({
      updated: await trx('branches').where({ id: bBranch.id }).update({ name: 'hacked' }),
      deleted: await trx('branches').where({ id: bBranch.id }).delete(),
    }));
    expect(result).toEqual({ updated: 0, deleted: 0 });
    expect((await ownerDb('branches').where({ id: bBranch.id }).first()).name).toBe('B main');
  });

  it('user sees only their own memberships across tenants', async () => {
    const rows = await withUser(appDb, userA, (trx) => trx('tenant_memberships'));
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
    expect(rows.every((r) => r.user_id === userA)).toBe(true);
  });

  it('app role cannot change migration history', async () => {
    await expect(appDb('knex_migrations').delete()).rejects.toThrow(/permission denied/);
  });

  it('every table with tenant_id has forced RLS', async () => {
    const { rows } = await ownerDb.raw(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
      WHERE c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(rows).toEqual([]);
  });
});
