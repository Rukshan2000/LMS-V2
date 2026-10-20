import type { Knex } from 'knex';

// Each institute picks an accent colour; everyone in it (staff, students, parents) sees it.
// The list must match THEMES in apps/api (tenancy) and the [data-theme] blocks in web globals.css.
// Numbered 020: 016 and 019 are held on their own tags.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.string('theme', 16).notNullable().defaultTo('blue');
  });
  await knex.raw(`ALTER TABLE tenants ADD CONSTRAINT tenants_theme_check
    CHECK (theme IN ('blue', 'teal', 'green', 'purple', 'rose', 'orange'))`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('theme');
  });
}
