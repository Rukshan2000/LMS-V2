import type { Knex } from 'knex';

// When the user agreed to the privacy notice at signup (Sri Lanka PDPA: record consent).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('privacy_accepted_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('privacy_accepted_at');
  });
}
