import type { Knex } from 'knex';

// Live class link (Zoom/Meet/Teams) per class. Shown in the portal only around class time and
// only to students whose fee for that month is not unpaid.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('batches', (t) => {
    t.string('live_url', 500);
  });
  await knex.raw(`ALTER TABLE batches
    ADD CONSTRAINT batches_live_url_https CHECK (live_url IS NULL OR live_url ~ '^https://')`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('batches', (t) => {
    t.dropColumn('live_url');
  });
}
