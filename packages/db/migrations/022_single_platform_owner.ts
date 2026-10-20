import type { Knex } from 'knex';

// The platform has one owner: at most one user with is_platform_admin. That user logs in only
// at the console (its own cookie) and cannot use the institute app. Fails if more than one
// admin exists; unflag the extras first.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE UNIQUE INDEX users_single_platform_admin ON users ((true)) WHERE is_platform_admin',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX users_single_platform_admin');
}
