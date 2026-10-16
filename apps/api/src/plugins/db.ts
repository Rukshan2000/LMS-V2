import fp from 'fastify-plugin';
import type { Knex } from 'knex';

declare module 'fastify' {
  interface FastifyInstance {
    /** Restricted app role: RLS applies. Tenant queries must go through withTenant. */
    db: Knex;
  }
}

// The caller owns the connection pool (created in index.ts or the test).
export default fp<{ db: Knex }>(async (app, { db }) => {
  app.decorate('db', db);
});
