import type { Knex } from 'knex';

// One live invoice per account and month, instead of one invoice ever (docs/SAAS_PLAN.md §8.1,
// changed during Phase 3): a voided invoice stays as a record, and the month can be generated
// again. Numbers stay unique, so the new invoice gets the next number of that period.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE UNIQUE INDEX subscription_invoices_one_live_per_period
    ON subscription_invoices (account_id, period) WHERE status <> 'void'`);
  await knex.raw(`ALTER TABLE subscription_invoices
    DROP CONSTRAINT subscription_invoices_account_id_period_unique`);
}

// Fails if a voided month was regenerated (two rows for one account and month): delete or
// renumber by hand first. Nothing else is lost.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE subscription_invoices
    ADD CONSTRAINT subscription_invoices_account_id_period_unique UNIQUE (account_id, period)`);
  await knex.raw('DROP INDEX subscription_invoices_one_live_per_period');
}
