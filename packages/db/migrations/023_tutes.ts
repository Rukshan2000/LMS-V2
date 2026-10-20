import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Tutes (class notes / handouts) per class. No file storage: the teacher gives a download link
// (Google Drive, Dropbox…) and enrolled students and their parents see it in the portal.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tutes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('batch_id').notNullable();
    t.string('title', 200).notNullable();
    t.text('description');
    t.string('url', 1000).notNullable();
    t.uuid('created_by_membership_id');
    t.timestamps(true, true);
    t.foreign(['tenant_id', 'batch_id'])
      .references(['tenant_id', 'id'])
      .inTable('batches')
      .onDelete('CASCADE');
    t.foreign(['tenant_id', 'created_by_membership_id'])
      .references(['tenant_id', 'id'])
      .inTable('tenant_memberships');
    t.index(['tenant_id', 'batch_id', 'created_at']);
  });
  await knex.raw(`ALTER TABLE tutes ADD CONSTRAINT tutes_url_https CHECK (url ~ '^https://')`);
  await enableTenantRls(knex, 'tutes');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('tutes');
}
