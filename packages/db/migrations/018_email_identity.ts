import type { Knex } from 'knex';

// Email becomes the login identity (docs/EMAIL_AUTH_PLAN.md §6). Phone stays as contact data.
// users.email keeps the existing unique index on lower(email) from 001; it becomes NOT NULL in a
// later migration, once existing phone-only users have verified an email.
// Numbered 018: 016 (drop_tenant_plan) is held on its own branch.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('email_verified_at');
  });
  await knex.raw('ALTER TABLE users ALTER COLUMN phone DROP NOT NULL');

  await knex.schema.alterTable('accounts', (t) => {
    t.string('owner_email', 254);
  });
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN owner_phone DROP NOT NULL,
    ADD CONSTRAINT accounts_owner_contact CHECK (owner_email IS NOT NULL OR owner_phone IS NOT NULL)`);
  await knex.raw(
    'CREATE INDEX accounts_owner_email ON accounts (lower(owner_email)) WHERE owner_user_id IS NULL',
  );

  await knex.schema.alterTable('tenant_invites', (t) => {
    t.string('email', 254);
  });
  await knex.raw(`ALTER TABLE tenant_invites ALTER COLUMN phone DROP NOT NULL,
    ADD CONSTRAINT tenant_invites_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)`);

  for (const table of ['students', 'guardians']) {
    await knex.schema.alterTable(table, (t) => {
      t.string('email', 254);
    });
  }

  // Global (no tenant_id, no RLS), like users and auth_sessions. The raw code is never stored.
  await knex.schema.createTable('email_otps', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 254).notNullable();
    t.string('purpose', 16).notNullable();
    // Who asked, for email_change (logged in). Null for signup / password_reset.
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('code_hash', 64).notNullable();
    t.smallint('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamp('consumed_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['email', 'purpose', 'created_at']);
  });
  await knex.raw(`ALTER TABLE email_otps ADD CONSTRAINT email_otps_purpose_check
    CHECK (purpose IN ('signup', 'password_reset', 'email_change'))`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('email_otps');
  for (const table of ['students', 'guardians']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('email');
    });
  }
  await knex.raw('ALTER TABLE tenant_invites DROP CONSTRAINT tenant_invites_contact');
  await knex.schema.alterTable('tenant_invites', (t) => {
    t.dropColumn('email');
  });
  await knex.raw('ALTER TABLE accounts DROP CONSTRAINT accounts_owner_contact');
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('owner_email');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('email_verified_at');
  });
  // phone / owner_phone / invite phone stay nullable: rows without them may exist by now.
}
