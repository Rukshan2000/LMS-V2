import type { Knex } from 'knex';
import { enableTenantRls } from '../src/rls.ts';

// Public web page per institute (/{lang}/i/{slug}). Off until the owner publishes it.
// Classes appear on it only when marked (batches.on_page); students and parents never do.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenant_pages', (t) => {
    t.uuid('tenant_id').primary().references('id').inTable('tenants').onDelete('CASCADE');
    t.boolean('published').notNullable().defaultTo(false);
    t.string('tagline', 200);
    t.text('about');
    // Digits-only international form (94771234567), like users.phone.
    t.string('phone', 15);
    t.string('whatsapp', 15);
    t.string('email', 254);
    t.string('address', 300);
    t.string('map_url', 500);
    t.string('facebook_url', 500);
    t.string('youtube_url', 500);
    t.string('tiktok_url', 500);
    t.boolean('show_fees').notNullable().defaultTo(true);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE tenant_pages
    ADD CONSTRAINT tenant_pages_about_length CHECK (char_length(about) <= 4000),
    ADD CONSTRAINT tenant_pages_https CHECK (
      (map_url IS NULL OR map_url ~ '^https://') AND
      (facebook_url IS NULL OR facebook_url ~ '^https://') AND
      (youtube_url IS NULL OR youtube_url ~ '^https://') AND
      (tiktok_url IS NULL OR tiktok_url ~ '^https://'))`);
  await enableTenantRls(knex, 'tenant_pages');

  await knex.schema.alterTable('batches', (t) => {
    t.boolean('on_page').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('batches', (t) => {
    t.dropColumn('on_page');
  });
  await knex.schema.dropTable('tenant_pages');
}
