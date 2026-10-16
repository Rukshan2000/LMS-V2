import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('subjects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
  });
  await knex.raw('CREATE UNIQUE INDEX subjects_tenant_name ON subjects (tenant_id, lower(name))');
  await enableTenantRls(knex, 'subjects');

  // A "class" in the UI: one subject, one group of students, one teacher, a weekly timetable.
  await knex.schema.createTable('batches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('subject_id').notNullable();
    t.string('name', 200).notNullable();
    t.uuid('teacher_membership_id');
    t.string('mode', 16).notNullable().defaultTo('physical');
    t.string('status', 16).notNullable().defaultTo('active');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'subject_id']).references(['tenant_id', 'id']).inTable('subjects');
    t.foreign(['tenant_id', 'teacher_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'teacher_membership_id']);
  });
  await knex.raw(`ALTER TABLE batches
    ADD CONSTRAINT batches_mode_check CHECK (mode IN ('physical', 'online', 'hybrid')),
    ADD CONSTRAINT batches_status_check CHECK (status IN ('active', 'archived'))`);
  await enableTenantRls(knex, 'batches');

  await knex.schema.createTable('enrollments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('batch_id').notNullable();
    t.uuid('student_id').notNullable();
    t.string('status', 16).notNullable().defaultTo('active');
    t.date('enrolled_on').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    t.date('left_on');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'batch_id']).references(['tenant_id', 'id']).inTable('batches');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'student_id']);
  });
  await knex.raw(
    `ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check CHECK (status IN ('active', 'left'))`,
  );
  // At most one active enrollment per student per class; history rows (left) may repeat.
  await knex.raw(`CREATE UNIQUE INDEX enrollments_one_active ON enrollments (tenant_id, batch_id, student_id)
    WHERE status = 'active'`);
  await enableTenantRls(knex, 'enrollments');

  // Weekly rule, e.g. Saturday 14:00–17:00 from 2026-11-01. Times are Asia/Colombo local time.
  await knex.schema.createTable('schedule_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('batch_id').notNullable();
    // ISO weekday: 1 = Monday … 7 = Sunday.
    t.smallint('weekday').notNullable();
    t.time('start_time').notNullable();
    t.time('end_time').notNullable();
    t.date('valid_from').notNullable();
    t.date('valid_to');
    t.string('room', 100);
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'batch_id'])
      .references(['tenant_id', 'id'])
      .inTable('batches')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE schedule_rules
    ADD CONSTRAINT schedule_rules_weekday_check CHECK (weekday BETWEEN 1 AND 7),
    ADD CONSTRAINT schedule_rules_time_order CHECK (end_time > start_time),
    ADD CONSTRAINT schedule_rules_date_order CHECK (valid_to IS NULL OR valid_to >= valid_from)`);
  await enableTenantRls(knex, 'schedule_rules');

  // One row per actual class meeting: the source of truth for attendance (slice 3).
  await knex.schema.createTable('class_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('batch_id').notNullable();
    // NULL for one-off extra classes. With a rule, occurrence_date identifies the slot even
    // after the session is moved, so regenerating never recreates a rescheduled class.
    t.uuid('schedule_rule_id');
    t.date('occurrence_date');
    t.timestamp('starts_at').notNullable();
    t.timestamp('ends_at').notNullable();
    t.string('status', 16).notNullable().defaultTo('scheduled');
    t.string('note', 300);
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.unique(['schedule_rule_id', 'occurrence_date']);
    t.foreign(['tenant_id', 'batch_id'])
      .references(['tenant_id', 'id'])
      .inTable('batches')
      .onDelete('CASCADE');
    // Rules are never deleted, only ended (valid_to), so no ON DELETE action is needed.
    t.foreign(['tenant_id', 'schedule_rule_id'])
      .references(['tenant_id', 'id'])
      .inTable('schedule_rules');
    t.index(['tenant_id', 'batch_id', 'starts_at']);
    t.index(['tenant_id', 'starts_at']);
  });
  await knex.raw(`ALTER TABLE class_sessions
    ADD CONSTRAINT class_sessions_status_check CHECK (status IN ('scheduled', 'cancelled')),
    ADD CONSTRAINT class_sessions_time_order CHECK (ends_at > starts_at)`);
  await enableTenantRls(knex, 'class_sessions');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('class_sessions');
  await knex.schema.dropTable('schedule_rules');
  await knex.schema.dropTable('enrollments');
  await knex.schema.dropTable('batches');
  await knex.schema.dropTable('subjects');
}
