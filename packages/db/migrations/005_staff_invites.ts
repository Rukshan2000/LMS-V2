import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Invite links look like /join/<tenantId>.<token>. The tenant id sets the RLS context for the
// lookup; the random token (stored only as a SHA-256 hash) is the secret.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenant_invites', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('full_name', 200).notNullable();
    // Only the user with this phone can accept, so a forwarded link is useless to others.
    t.string('phone', 15).notNullable();
    t.string('role', 16).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.string('status', 16).notNullable().defaultTo('pending');
    t.timestamp('expires_at').notNullable();
    t.uuid('invited_by_membership_id');
    t.uuid('accepted_by_user_id').references('id').inTable('users');
    t.timestamps(true, true);
    t.foreign(['tenant_id', 'invited_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'status']);
  });
  await knex.raw(`ALTER TABLE tenant_invites
    ADD CONSTRAINT tenant_invites_role_check CHECK (role IN ('admin', 'teacher', 'receptionist')),
    ADD CONSTRAINT tenant_invites_status_check CHECK (status IN ('pending', 'accepted', 'revoked')),
    ADD CONSTRAINT tenant_invites_phone_digits CHECK (phone ~ '^[0-9]{9,15}$')`);
  await enableTenantRls(knex, 'tenant_invites');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('tenant_invites');
}
