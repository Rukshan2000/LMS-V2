import type { Knex } from 'knex';

// Global tables (no tenant_id, no RLS): a user is a login identity, not tenant data.
// gen_random_uuid() is built into PostgreSQL 13+, so no pgcrypto extension needed.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Digits only, e.g. 94771234567 (also the wa.me format).
    t.string('phone', 15).notNullable().unique();
    t.string('email', 254);
    t.string('full_name', 200).notNullable();
    t.text('password_hash').notNullable();
    t.string('status', 16).notNullable().defaultTo('active');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE users
    ADD CONSTRAINT users_phone_digits CHECK (phone ~ '^[0-9]{9,15}$'),
    ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))`);
  await knex.raw(
    'CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL',
  );

  await knex.schema.createTable('auth_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // SHA-256 of the cookie token; the raw token is never stored.
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at');
    t.string('ip', 45);
    t.string('user_agent', 300);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('auth_sessions');
  await knex.schema.dropTable('users');
}
