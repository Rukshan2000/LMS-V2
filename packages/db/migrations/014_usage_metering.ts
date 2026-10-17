import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Head-count metering for per-head billing (docs/SAAS_PLAN.md §6.3). The database records the
// counts, so no code path can forget to: statement-level AFTER triggers on the tables that
// define a head upsert today's count per institute. One row per institute, head and Sri Lanka
// day; count_max is the day's peak, count_last the latest. Days without a change have no row.

const TABLES = ['students', 'membership_roles', 'tenant_memberships'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenant_usage_daily', (t) => {
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('head', 16).notNullable();
    // Asia/Colombo date, like lib/time.ts colomboToday().
    t.date('day').notNullable();
    t.integer('count_max').notNullable();
    t.integer('count_last').notNullable();
    t.primary(['tenant_id', 'head', 'day']);
  });
  await knex.raw(`ALTER TABLE tenant_usage_daily ADD CONSTRAINT tenant_usage_daily_head_check
    CHECK (head IN ('student', 'teacher', 'parent', 'admin', 'receptionist'))`);
  await enableTenantRls(knex, 'tenant_usage_daily');

  // Counts every head of one institute and upserts today's row. Runs as the caller, under the
  // caller's RLS context (always that tenant: the writer's own WITH CHECK requires it). The
  // explicit tenant filters keep it correct for roles that bypass RLS.
  await knex.raw(`CREATE FUNCTION meter_tenant(p_tenant uuid) RETURNS void
    LANGUAGE sql SECURITY INVOKER AS $$
    INSERT INTO tenant_usage_daily AS u (tenant_id, head, day, count_max, count_last)
    SELECT p_tenant, c.head, (now() AT TIME ZONE 'Asia/Colombo')::date, c.n, c.n FROM (
      SELECT 'student' AS head, count(*)::int AS n
        FROM students WHERE tenant_id = p_tenant AND status = 'active'
      UNION ALL
      SELECT h.head, count(DISTINCT m.id)::int
        FROM unnest(ARRAY['teacher', 'parent', 'admin', 'receptionist']) AS h(head)
        LEFT JOIN membership_roles r ON r.tenant_id = p_tenant AND r.role = h.head
        LEFT JOIN tenant_memberships m
          ON m.id = r.membership_id AND m.tenant_id = p_tenant AND m.status = 'active'
        GROUP BY h.head
    ) c
    ON CONFLICT (tenant_id, head, day) DO UPDATE
      SET count_max = GREATEST(u.count_max, EXCLUDED.count_last),
          count_last = EXCLUDED.count_last
  $$`);

  // One count per affected institute per statement (a 500-row import counts once). Skips
  // institutes deleted in the same statement (cascade), which have nothing left to bill.
  await knex.raw(`CREATE FUNCTION meter_heads() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER AS $$
    BEGIN
      PERFORM meter_tenant(c.tenant_id)
        FROM (SELECT DISTINCT tenant_id FROM changed) c
        WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id);
      RETURN NULL;
    END $$`);

  // A trigger with transition tables can have only one event and no column list (UPDATE OF), so
  // three per table, and every UPDATE recounts (one indexed count per statement).
  for (const table of TABLES) {
    await knex.raw(`CREATE TRIGGER ${table}_meter_insert AFTER INSERT ON ${table}
      REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION meter_heads()`);
    await knex.raw(`CREATE TRIGGER ${table}_meter_update AFTER UPDATE ON ${table}
      REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION meter_heads()`);
    await knex.raw(`CREATE TRIGGER ${table}_meter_delete AFTER DELETE ON ${table}
      REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION meter_heads()`);
  }

  // Opening counts for the first billed month. Per tenant context, like 013's backfill: the
  // production migration role may not bypass the forced RLS on these tables.
  const tenants: string[] = await knex('tenants').orderBy('created_at').pluck('id');
  for (const id of tenants) {
    await knex.raw("SELECT set_config('app.tenant_id', ?, true)", [id]);
    await knex.raw('SELECT meter_tenant(?)', [id]);
  }
  await knex.raw("SELECT set_config('app.tenant_id', '', true)");
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    for (const event of ['insert', 'update', 'delete']) {
      await knex.raw(`DROP TRIGGER ${table}_meter_${event} ON ${table}`);
    }
  }
  await knex.raw('DROP FUNCTION meter_heads()');
  await knex.raw('DROP FUNCTION meter_tenant(uuid)');
  await knex.schema.dropTable('tenant_usage_daily');
}
