import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Money: numeric(12,2) in LKR everywhere, never floating point. Posted payments are never
// deleted; they are reversed (later) or simply not allocated.
export async function up(knex: Knex): Promise<void> {
  // Monthly fee components per class.
  await knex.schema.createTable('batch_fees', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('batch_id').notNullable();
    t.string('kind', 16).notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.timestamps(true, true);
    t.primary(['batch_id', 'kind']);
    t.foreign(['tenant_id', 'batch_id'])
      .references(['tenant_id', 'id'])
      .inTable('batches')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE batch_fees
    ADD CONSTRAINT batch_fees_kind_check CHECK (kind IN ('class', 'ac', 'tute')),
    ADD CONSTRAINT batch_fees_amount_check CHECK (amount >= 0)`);
  await enableTenantRls(knex, 'batch_fees');

  // Free card / half card / percentage discount on the class fee. batch_id NULL = all classes.
  await knex.schema.createTable('student_concessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('student_id').notNullable();
    t.uuid('batch_id');
    t.string('type', 16).notNullable();
    t.decimal('percent', 5, 2).notNullable();
    t.string('note', 200);
    t.timestamps(true, true);
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'batch_id'])
      .references(['tenant_id', 'id'])
      .inTable('batches')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE student_concessions
    ADD CONSTRAINT student_concessions_type_check CHECK (type IN ('free_card', 'half_card', 'percent')),
    ADD CONSTRAINT student_concessions_percent_check CHECK (percent > 0 AND percent <= 100)`);
  // One concession per student per class (or one "all classes" concession).
  await knex.raw(`CREATE UNIQUE INDEX student_concessions_one ON student_concessions
    (tenant_id, student_id, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid))`);
  await enableTenantRls(knex, 'student_concessions');

  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('student_id').notNullable();
    t.string('invoice_number', 20).notNullable();
    // YYYY-MM for monthly invoices; NULL for one-off charges (admission, etc.).
    t.string('period', 7);
    t.date('due_date').notNullable();
    t.decimal('total', 12, 2).notNullable().defaultTo(0);
    t.decimal('paid', 12, 2).notNullable().defaultTo(0);
    t.string('status', 16).notNullable().defaultTo('issued');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.unique(['tenant_id', 'invoice_number']);
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'student_id', 'status', 'due_date']);
    t.index(['tenant_id', 'period']);
  });
  await knex.raw(`ALTER TABLE invoices
    ADD CONSTRAINT invoices_period_format CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    ADD CONSTRAINT invoices_status_check CHECK (status IN ('issued', 'part_paid', 'paid', 'void')),
    ADD CONSTRAINT invoices_amounts_check CHECK (total >= 0 AND paid >= 0 AND paid <= total)`);
  // Monthly billing can run again safely: one monthly invoice per student per month.
  await knex.raw(`CREATE UNIQUE INDEX invoices_one_per_period ON invoices (tenant_id, student_id, period)
    WHERE period IS NOT NULL AND status <> 'void'`);
  await enableTenantRls(knex, 'invoices');

  await knex.schema.createTable('invoice_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('invoice_id').notNullable();
    t.uuid('batch_id');
    t.string('kind', 16).notNullable();
    t.string('description', 200).notNullable();
    // Negative for concessions.
    t.decimal('amount', 12, 2).notNullable();
    t.foreign(['tenant_id', 'invoice_id'])
      .references(['tenant_id', 'id'])
      .inTable('invoices')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'batch_id']).references(['tenant_id', 'id']).inTable('batches');
    t.index(['tenant_id', 'invoice_id']);
  });
  await knex.raw(`ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_kind_check
    CHECK (kind IN ('class', 'ac', 'tute', 'concession', 'admission', 'late', 'other'))`);
  // Re-running billing never adds the same class fee twice to an invoice.
  await knex.raw(`CREATE UNIQUE INDEX invoice_lines_once ON invoice_lines (invoice_id, batch_id, kind)
    WHERE batch_id IS NOT NULL`);
  await enableTenantRls(knex, 'invoice_lines');

  await knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('student_id').notNullable();
    t.string('receipt_number', 20).notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.string('method', 16).notNullable();
    // Cash and staff-entered transfers are verified on entry; bank slips (slice 5) start pending.
    t.string('status', 16).notNullable().defaultTo('verified');
    t.string('reference', 100);
    // Generated by the browser per submit: a double click or retry cannot record twice.
    t.uuid('client_ref').notNullable();
    t.uuid('received_by_membership_id');
    t.timestamp('received_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'id']);
    t.unique(['tenant_id', 'receipt_number']);
    t.unique(['tenant_id', 'client_ref']);
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'received_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'received_at']);
    t.index(['tenant_id', 'student_id']);
  });
  await knex.raw(`ALTER TABLE payments
    ADD CONSTRAINT payments_amount_check CHECK (amount > 0),
    ADD CONSTRAINT payments_method_check CHECK (method IN ('cash', 'bank_transfer', 'slip')),
    ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'verified', 'rejected'))`);
  await enableTenantRls(knex, 'payments');

  await knex.schema.createTable('payment_allocations', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('payment_id').notNullable();
    t.uuid('invoice_id').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.primary(['payment_id', 'invoice_id']);
    t.foreign(['tenant_id', 'payment_id'])
      .references(['tenant_id', 'id'])
      .inTable('payments')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'invoice_id'])
      .references(['tenant_id', 'id'])
      .inTable('invoices')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'invoice_id']);
  });
  await knex.raw(
    `ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount_check CHECK (amount > 0)`,
  );
  await enableTenantRls(knex, 'payment_allocations');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('payment_allocations');
  await knex.schema.dropTable('payments');
  await knex.schema.dropTable('invoice_lines');
  await knex.schema.dropTable('invoices');
  await knex.schema.dropTable('student_concessions');
  await knex.schema.dropTable('batch_fees');
}
