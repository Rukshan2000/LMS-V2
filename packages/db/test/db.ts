import { createKnex } from '../src/knex.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

/** Owner connection: bypasses RLS. Use only to arrange/clean test data. */
export const owner = () => createKnex(required('TEST_MIGRATION_DATABASE_URL'));
/** App connection: restricted role, RLS applies. One connection proves context does not leak. */
export const app = () => createKnex(required('TEST_DATABASE_URL'), { min: 1, max: 1 });
