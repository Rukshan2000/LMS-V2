import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Online quizzes and exams (docs/QUIZ_PLAN.md §11). A quiz belongs to one class (batch).
// MCQ answers are marked by the API on submit; typed answers wait for the teacher.
// No files: photo answers and question images were dropped (no object storage).
// Numbered 017: 016 (drop_tenant_plan) is held on its own branch.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('quizzes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('batch_id').notNullable();
    t.string('title', 200).notNullable();
    t.text('instructions');
    t.string('status', 16).notNullable().defaultTo('draft');
    t.timestamp('opens_at').notNullable();
    t.timestamp('closes_at').notNullable();
    t.integer('time_limit_minutes');
    t.boolean('shuffle_questions').notNullable().defaultTo(true);
    t.boolean('shuffle_options').notNullable().defaultTo(true);
    t.boolean('show_correct').notNullable().defaultTo(true);
    t.boolean('show_explanations').notNullable().defaultTo(true);
    // "Paid students only": no issued/part-paid invoice for the month the attempt starts in.
    t.boolean('require_paid').notNullable().defaultTo(false);
    t.string('auto_release', 16).notNullable().defaultTo('on_close');
    t.decimal('total_points', 7, 2).notNullable().defaultTo(0);
    t.uuid('created_by_membership_id');
    t.timestamp('released_at');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'batch_id']).references(['tenant_id', 'id']).inTable('batches');
    t.foreign(['tenant_id', 'created_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'batch_id', 'opens_at']);
  });
  await knex.raw(`ALTER TABLE quizzes
    ADD CONSTRAINT quizzes_status_check CHECK (status IN ('draft', 'published', 'released')),
    ADD CONSTRAINT quizzes_auto_release_check CHECK (auto_release IN ('off', 'on_submit', 'on_close')),
    ADD CONSTRAINT quizzes_window_check CHECK (closes_at > opens_at),
    ADD CONSTRAINT quizzes_time_limit_check CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 1440)`);
  await enableTenantRls(knex, 'quizzes');

  await knex.schema.createTable('quiz_questions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('quiz_id').notNullable();
    t.integer('position').notNullable();
    t.string('type', 16).notNullable();
    t.text('body').notNullable();
    t.text('explanation');
    t.decimal('points', 5, 2).notNullable().defaultTo(1);
    t.string('multi_scoring', 16).notNullable().defaultTo('all_or_nothing');
    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'quiz_id'])
      .references(['tenant_id', 'id'])
      .inTable('quizzes')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'quiz_id', 'position']);
  });
  await knex.raw(`ALTER TABLE quiz_questions
    ADD CONSTRAINT quiz_questions_type_check CHECK (type IN ('mcq', 'multi', 'short', 'essay')),
    ADD CONSTRAINT quiz_questions_scoring_check CHECK (multi_scoring IN ('all_or_nothing', 'partial')),
    ADD CONSTRAINT quiz_questions_points_check CHECK (points > 0)`);
  await enableTenantRls(knex, 'quiz_questions');

  await knex.schema.createTable('quiz_options', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('question_id').notNullable();
    t.integer('position').notNullable();
    t.text('body').notNullable();
    t.boolean('is_correct').notNullable().defaultTo(false);
    t.foreign(['tenant_id', 'question_id'])
      .references(['tenant_id', 'id'])
      .inTable('quiz_questions')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'question_id']);
  });
  await enableTenantRls(knex, 'quiz_options');

  await knex.schema.createTable('quiz_attempts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('quiz_id').notNullable();
    t.uuid('student_id').notNullable();
    // The student login that sat it.
    t.uuid('membership_id').notNullable();
    t.string('status', 16).notNullable().defaultTo('in_progress');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('deadline').notNullable();
    t.timestamp('submitted_at');
    // Shuffled once at start, so a refresh or a second device shows the same order.
    t.specificType('question_order', 'uuid[]').notNullable();
    t.decimal('score', 7, 2);
    // True once every answer has a score (MCQ at submit; typed answers when the teacher marks).
    t.boolean('marked').notNullable().defaultTo(false);
    t.unique(['tenant_id', 'id']);
    t.unique(['tenant_id', 'quiz_id', 'student_id']);
    t.foreign(['tenant_id', 'quiz_id'])
      .references(['tenant_id', 'id'])
      .inTable('quizzes')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE quiz_attempts
    ADD CONSTRAINT quiz_attempts_status_check CHECK (status IN ('in_progress', 'submitted', 'timed_out'))`);
  await knex.raw(`CREATE INDEX quiz_attempts_open ON quiz_attempts (tenant_id, deadline)
    WHERE status = 'in_progress'`);
  await enableTenantRls(knex, 'quiz_attempts');

  // One row per question, created when the attempt starts (unanswered = no options / no text).
  await knex.schema.createTable('quiz_answers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('attempt_id').notNullable();
    t.uuid('question_id').notNullable();
    t.specificType('option_ids', 'uuid[]').notNullable().defaultTo('{}');
    t.specificType('option_order', 'uuid[]').notNullable().defaultTo('{}');
    t.text('text');
    // Null = waiting for a mark. Score with no marker = marked by the system.
    t.decimal('score', 5, 2);
    t.uuid('marked_by_membership_id');
    t.text('comment');
    t.timestamp('saved_at');
    t.timestamp('marked_at');
    t.unique(['tenant_id', 'id']);
    t.unique(['attempt_id', 'question_id']);
    t.foreign(['tenant_id', 'attempt_id'])
      .references(['tenant_id', 'id'])
      .inTable('quiz_attempts')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'question_id'])
      .references(['tenant_id', 'id'])
      .inTable('quiz_questions')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'marked_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
  });
  await knex.raw(`CREATE INDEX quiz_answers_to_mark ON quiz_answers (tenant_id, question_id)
    WHERE score IS NULL`);
  await enableTenantRls(knex, 'quiz_answers');

  // On in every existing price book until pricing decides otherwise (QUIZ_PLAN §16 Q4).
  await knex.raw(`UPDATE price_books SET values = values || '{"feature.quizzes": true}'::jsonb,
    updated_at = now()`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`UPDATE price_books SET values = values - 'feature.quizzes'`);
  await knex.raw(`DELETE FROM account_overrides WHERE key = 'feature.quizzes'`);
  for (const table of [
    'quiz_answers',
    'quiz_attempts',
    'quiz_options',
    'quiz_questions',
    'quizzes',
  ]) {
    await knex.schema.dropTable(table);
  }
}
