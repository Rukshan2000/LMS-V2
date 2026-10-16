import { createKnex, migrateLatest } from '@lms/db';

export default async function setup() {
  const db = createKnex(process.env.TEST_MIGRATION_DATABASE_URL!);
  try {
    await migrateLatest(db);
  } finally {
    await db.destroy();
  }
}
