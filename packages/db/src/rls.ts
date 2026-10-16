import type { Knex } from 'knex';

/** Enable + force tenant RLS on a table with a `tenant_id` column. Use in every tenant-owned table's migration. */
export async function enableTenantRls(knex: Knex, table: string): Promise<void> {
  await knex.raw('ALTER TABLE ?? ENABLE ROW LEVEL SECURITY', [table]);
  await knex.raw('ALTER TABLE ?? FORCE ROW LEVEL SECURITY', [table]);
  await knex.raw(
    `CREATE POLICY ?? ON ?? USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())`,
    [`${table}_tenant_isolation`, table],
  );
}
