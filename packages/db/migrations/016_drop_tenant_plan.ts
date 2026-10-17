import type { Knex } from 'knex';

// Contract step of the move to accounts (docs/SAAS_PLAN.md §8.2, §4 rule 11). Since Phase 1 no
// code reads tenants.plan or plan_expires_at: limits, trials and prices come from billing.
// Run only after Phase 1 has been live for at least one release, so a code rollback still works.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE tenants
    DROP CONSTRAINT tenants_paid_plan_expiry,
    DROP CONSTRAINT tenants_plan_check`);
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('plan_expires_at');
    t.dropColumn('plan');
  });
}

// Puts the columns back as migrations 002 and 011 made them, with every tenant on 'free': the
// old plan values are gone (accounts and price books hold that information now).
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.string('plan', 32).notNullable().defaultTo('free');
    t.timestamp('plan_expires_at');
  });
  await knex.raw(`ALTER TABLE tenants
    ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('free', 'teacher', 'institute')),
    ADD CONSTRAINT tenants_paid_plan_expiry CHECK (plan = 'free' OR plan_expires_at IS NOT NULL)`);
}
