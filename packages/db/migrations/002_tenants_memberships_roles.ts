import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

const ROLES = ['owner', 'admin', 'teacher', 'receptionist', 'student', 'parent'];

export async function up(knex: Knex): Promise<void> {
  // Used by every RLS policy. Missing/empty context → NULL → no rows match (fail closed).
  await knex.raw(`CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$`);
  await knex.raw(`CREATE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$`);

  // Global registry of institutes/teachers. Access is checked in the API via memberships.
  await knex.schema.createTable('tenants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('slug', 60).notNullable().unique();
    t.string('name', 200).notNullable();
    t.string('status', 16).notNullable().defaultTo('trial');
    t.string('plan', 32).notNullable().defaultTo('free');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE tenants
    ADD CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$'),
    ADD CONSTRAINT tenants_status_check CHECK (status IN ('trial', 'active', 'suspended'))`);

  await knex.schema.createTable('branches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
  });
  await enableTenantRls(knex, 'branches');

  await knex.schema.createTable('tenant_memberships', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('status', 16).notNullable().defaultTo('active');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'user_id']);
    t.unique(['tenant_id', 'id']);
    t.index(['user_id']);
  });
  await knex.raw(`ALTER TABLE tenant_memberships
    ADD CONSTRAINT tenant_memberships_status_check CHECK (status IN ('invited', 'active', 'disabled'))`);
  await enableTenantRls(knex, 'tenant_memberships');
  // A user may list their own memberships in every tenant (tenant switcher, membership check).
  await knex.raw(`CREATE POLICY tenant_memberships_self_read ON tenant_memberships
    FOR SELECT USING (user_id = app_current_user())`);

  await knex.schema.createTable('membership_roles', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('membership_id').notNullable();
    t.string('role', 16).notNullable();
    t.primary(['membership_id', 'role']);
    t.foreign(['tenant_id', 'membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships')
      .onDelete('CASCADE');
  });
  // Constant list, not user input: safe to inline (DDL cannot take bound parameters).
  await knex.raw(
    `ALTER TABLE membership_roles ADD CONSTRAINT membership_roles_role_check
      CHECK (role IN (${ROLES.map((r) => `'${r}'`).join(', ')}))`,
  );
  await enableTenantRls(knex, 'membership_roles');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('membership_roles');
  await knex.schema.dropTable('tenant_memberships');
  await knex.schema.dropTable('branches');
  await knex.schema.dropTable('tenants');
  await knex.raw('DROP FUNCTION app_current_user()');
  await knex.raw('DROP FUNCTION app_current_tenant()');
}
