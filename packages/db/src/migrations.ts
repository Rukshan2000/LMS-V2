import type { Knex } from 'knex';

/** Apply pending migrations, then make migration history writable by the owner only. */
export async function migrateLatest(knex: Knex): Promise<string[]> {
  const [, applied] = await knex.migrate.latest();
  // Default privileges grant the app role access to every new table, including Knex's own.
  await knex.raw(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
      WHERE table_name IN ('knex_migrations', 'knex_migrations_lock') AND grantee <> current_user
    LOOP EXECUTE format('REVOKE ALL ON knex_migrations, knex_migrations_lock FROM %I', r.grantee);
    END LOOP; END $$`);
  return applied;
}
