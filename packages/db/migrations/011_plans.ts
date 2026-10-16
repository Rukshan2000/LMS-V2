import type { Knex } from 'knex';

// Plans are switched on by hand after a bank transfer (docs/runbooks/plans.md). A paid plan
// runs until plan_expires_at, then the tenant is on Free limits again. Nothing is deleted.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.timestamp('plan_expires_at');
  });
  await knex.raw(`ALTER TABLE tenants
    ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('free', 'teacher', 'institute')),
    ADD CONSTRAINT tenants_paid_plan_expiry CHECK (plan = 'free' OR plan_expires_at IS NOT NULL)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tenants
    DROP CONSTRAINT tenants_paid_plan_expiry,
    DROP CONSTRAINT tenants_plan_check`);
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('plan_expires_at');
  });
}
