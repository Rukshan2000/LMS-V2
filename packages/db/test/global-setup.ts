import { migrateLatest } from '../src/migrations.js';
import { owner } from './db.js';

// Fresh schema for every run: roll everything back, then apply all migrations.
export default async function setup() {
  const db = owner();
  try {
    await db.migrate.rollback(undefined, true);
    await migrateLatest(db);
  } finally {
    await db.destroy();
  }
}
