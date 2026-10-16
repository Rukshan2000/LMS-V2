import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Student/parent portal. Staff send a WhatsApp invite link (same flow as staff invites); only
// the invited mobile can accept, which proves the person holds that phone. Access is explicit
// per student, so a parent sees exactly the children they were invited for.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenant_invites', (t) => {
    t.uuid('student_id');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
  });
  await knex.raw(`ALTER TABLE tenant_invites
    DROP CONSTRAINT tenant_invites_role_check,
    ADD CONSTRAINT tenant_invites_role_check
      CHECK (role IN ('admin', 'teacher', 'receptionist', 'student', 'parent')),
    ADD CONSTRAINT tenant_invites_portal_student
      CHECK ((role IN ('student', 'parent')) = (student_id IS NOT NULL))`);

  await knex.schema.createTable('portal_access', (t) => {
    t.uuid('tenant_id').notNullable();
    t.uuid('membership_id').notNullable();
    t.uuid('student_id').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['membership_id', 'student_id']);
    t.foreign(['tenant_id', 'membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'student_id'])
      .references(['tenant_id', 'id'])
      .inTable('students')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'student_id']);
  });
  await enableTenantRls(knex, 'portal_access');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('portal_access');
  // Portal invites cannot exist without the portal.
  await knex('tenant_invites').whereNotNull('student_id').delete();
  await knex.raw(`ALTER TABLE tenant_invites
    DROP CONSTRAINT tenant_invites_portal_student,
    DROP CONSTRAINT tenant_invites_role_check,
    ADD CONSTRAINT tenant_invites_role_check CHECK (role IN ('admin', 'teacher', 'receptionist'))`);
  await knex.schema.alterTable('tenant_invites', (t) => {
    t.dropForeign(['tenant_id', 'student_id']);
    t.dropColumn('student_id');
  });
}
