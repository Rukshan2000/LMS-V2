import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

export async function up(knex: Knex): Promise<void> {
  // QR class cards. The token is random and contains no personal data; it only works when
  // scanned by logged-in staff of the same tenant, so it is stored as-is (cards can be reprinted).
  await knex.schema.createTable('student_cards', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('student_id').notNullable();
    t.string('token', 32).notNullable().unique();
    t.string('status', 16).notNullable().defaultTo('active');
    t.timestamp('issued_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE student_cards
    ADD CONSTRAINT student_cards_status_check CHECK (status IN ('active', 'revoked'))`);
  await knex.raw(`CREATE UNIQUE INDEX student_cards_one_active ON student_cards (tenant_id, student_id)
    WHERE status = 'active'`);
  await enableTenantRls(knex, 'student_cards');

  await knex.schema.createTable('attendance_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('session_id').notNullable();
    t.uuid('student_id').notNullable();
    t.string('status', 16).notNullable();
    t.string('method', 16).notNullable();
    t.uuid('marked_by_membership_id');
    t.timestamp('marked_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'id']);
    // One record per student per class: repeated scans can never duplicate.
    t.unique(['tenant_id', 'session_id', 'student_id']);
    t.foreign(['tenant_id', 'session_id'])
      .references(['tenant_id', 'id'])
      .inTable('class_sessions')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'marked_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'student_id', 'marked_at']);
  });
  await knex.raw(`ALTER TABLE attendance_records
    ADD CONSTRAINT attendance_status_check CHECK (status IN ('present', 'late', 'absent')),
    ADD CONSTRAINT attendance_method_check CHECK (method IN ('scan', 'manual'))`);
  await enableTenantRls(knex, 'attendance_records');

  // Audit trail: every change to an existing record (who, from, to, when).
  await knex.schema.createTable('attendance_changes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('attendance_id').notNullable();
    t.string('old_status', 16).notNullable();
    t.string('new_status', 16).notNullable();
    t.uuid('changed_by_membership_id');
    t.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    t.foreign(['tenant_id', 'attendance_id'])
      .references(['tenant_id', 'id'])
      .inTable('attendance_records')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'changed_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'attendance_id']);
  });
  await enableTenantRls(knex, 'attendance_changes');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('attendance_changes');
  await knex.schema.dropTable('attendance_records');
  await knex.schema.dropTable('student_cards');
}
