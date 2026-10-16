import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Bank slips: a parent/student uploads a photo of the deposit slip; it is a `payments` row with
// method 'slip' and status 'pending' until desk staff verify (allocate + receipt) or reject it.
export async function up(knex: Knex): Promise<void> {
  // Receipt numbers are given on verification, so rejected slips leave no gaps in receipts.
  await knex.raw(`ALTER TABLE payments
    ALTER COLUMN receipt_number DROP NOT NULL,
    ADD CONSTRAINT payments_verified_receipt CHECK (status <> 'verified' OR receipt_number IS NOT NULL)`);
  await knex.schema.alterTable('payments', (t) => {
    t.uuid('submitted_by_user_id').references('id').inTable('users');
    t.timestamp('reviewed_at');
    t.string('review_note', 200);
  });
  await knex.raw(
    `CREATE INDEX payments_pending ON payments (tenant_id, received_at) WHERE status = 'pending'`,
  );

  // ponytail: files live in Postgres (RLS + backups for free). Move to object storage when
  // the database grows past a few GB.
  await knex.schema.createTable('payment_slips', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('payment_id').primary();
    t.string('content_type', 32).notNullable();
    t.string('sha256', 64).notNullable();
    t.specificType('data', 'bytea').notNullable();
    t.foreign(['tenant_id', 'payment_id'])
      .references(['tenant_id', 'id'])
      .inTable('payments')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'sha256']);
  });
  await enableTenantRls(knex, 'payment_slips');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('payment_slips');
  // Unverified slips have no receipt number, which the old schema requires.
  await knex('payments').whereNull('receipt_number').delete();
  await knex.raw('DROP INDEX payments_pending');
  await knex.schema.alterTable('payments', (t) => {
    t.dropColumn('review_note');
    t.dropColumn('reviewed_at');
    t.dropColumn('submitted_by_user_id');
  });
  await knex.raw(`ALTER TABLE payments
    DROP CONSTRAINT payments_verified_receipt,
    ALTER COLUMN receipt_number SET NOT NULL`);
}
