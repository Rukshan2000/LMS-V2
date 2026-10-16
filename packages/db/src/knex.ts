import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex, { type Knex } from 'knex';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export function createKnex(connectionString: string, pool: Knex.PoolConfig = {}): Knex {
  return knex({
    client: 'pg',
    connection: connectionString,
    pool: { min: 0, max: 10, ...pool },
    migrations: { directory: migrationsDir, loadExtensions: ['.ts'] },
  });
}
