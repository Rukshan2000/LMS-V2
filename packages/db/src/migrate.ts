import { createKnex } from './knex.js';
import { migrateLatest } from './migrations.js';

const commands = ['latest', 'rollback', 'status', 'check'] as const;
const command = process.argv[2] as (typeof commands)[number];
const url = process.env.MIGRATION_DATABASE_URL;

if (!commands.includes(command) || !url) {
  console.error(`Usage: MIGRATION_DATABASE_URL=... migrate <${commands.join('|')}>`);
  process.exit(1);
}

const knex = createKnex(url, { max: 1 });
try {
  if (command === 'latest') {
    const done = await migrateLatest(knex);
    console.log(done.length ? `Applied: ${done.join(', ')}` : 'Already up to date');
  } else if (command === 'rollback') {
    // Rolls back the last batch. Use only on local/test databases.
    const [, done] = await knex.migrate.rollback();
    console.log(done.length ? `Rolled back: ${done.join(', ')}` : 'Nothing to roll back');
  } else if (command === 'status') {
    const [done, pending] = await knex.migrate.list();
    console.log(`Applied: ${done.length}, pending: ${pending.length}`);
  } else {
    // CI: prove every migration applies to an empty DB and rolls back cleanly.
    await migrateLatest(knex);
    await knex.migrate.rollback(undefined, true);
    await migrateLatest(knex);
    console.log('Migrations: up → down → up OK');
  }
} finally {
  await knex.destroy();
}
