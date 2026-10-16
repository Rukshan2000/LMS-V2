import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

export async function up(knex: Knex): Promise<void> {
  // Per-tenant counters (student numbers now, invoice numbers later). Atomic via upsert.
  await knex.schema.createTable('tenant_counters', (t) => {
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('key', 32).notNullable();
    t.bigInteger('value').notNullable();
    t.primary(['tenant_id', 'key']);
  });
  await enableTenantRls(knex, 'tenant_counters');

  await knex.schema.createTable('students', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('student_number', 20).notNullable();
    t.string('full_name', 200).notNullable();
    // Student's own mobile (optional; many students use a parent's phone).
    t.string('phone', 15);
    t.string('school', 200);
    // Free text, e.g. "2027 A/L" or "Grade 10".
    t.string('grade', 50);
    t.string('status', 16).notNullable().defaultTo('active');
    t.text('notes');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.unique(['tenant_id', 'student_number']);
  });
  await knex.raw(`ALTER TABLE students
    ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'inactive')),
    ADD CONSTRAINT students_phone_digits CHECK (phone IS NULL OR phone ~ '^[0-9]{9,15}$')`);
  // ponytail: plain ILIKE search, fine for ≤ a few thousand students per tenant. Add pg_trgm when slow.
  await knex.raw('CREATE INDEX students_tenant_name ON students (tenant_id, lower(full_name), id)');
  await enableTenantRls(knex, 'students');

  // One guardian record per phone per tenant, shared by siblings.
  await knex.schema.createTable('guardians', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('full_name', 200).notNullable();
    t.string('phone', 15).notNullable();
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.unique(['tenant_id', 'phone']);
  });
  await knex.raw(
    `ALTER TABLE guardians ADD CONSTRAINT guardians_phone_digits CHECK (phone ~ '^[0-9]{9,15}$')`,
  );
  await enableTenantRls(knex, 'guardians');

  await knex.schema.createTable('student_guardians', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('student_id').notNullable();
    t.uuid('guardian_id').notNullable();
    t.string('relationship', 16).notNullable().defaultTo('guardian');
    t.primary(['student_id', 'guardian_id']);
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'guardian_id'])
      .references(['tenant_id', 'id'])
      .inTable('guardians')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'guardian_id']);
  });
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_relationship_check
    CHECK (relationship IN ('mother', 'father', 'guardian'))`);
  await enableTenantRls(knex, 'student_guardians');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('student_guardians');
  await knex.schema.dropTable('guardians');
  await knex.schema.dropTable('students');
  await knex.schema.dropTable('tenant_counters');
}
