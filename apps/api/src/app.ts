import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Knex } from 'knex';
import identityRoutes from './modules/identity/routes.js';
import tenancyRoutes from './modules/tenancy/routes.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import errorsPlugin from './plugins/errors.js';
import tenantPlugin from './plugins/tenant.js';

export interface AppOptions {
  db: Knex;
  secureCookies: boolean;
  /** Login/signup attempts per IP per minute. */
  authRateLimitMax?: number;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  db,
  secureCookies,
  authRateLimitMax = 10,
  logger = true,
}: AppOptions) {
  // trustProxy: nginx on the same host sets X-Forwarded-For (needed for rate limits + session IP).
  const app = Fastify({ logger, trustProxy: '127.0.0.1' });

  await app.register(errorsPlugin);
  await app.register(dbPlugin, { db });
  await app.register(authPlugin, { secureCookies });
  await app.register(tenantPlugin);
  await app.register(rateLimit, { global: false });

  app.get('/api/health', async () => {
    await db.raw('select 1');
    return { status: 'ok' };
  });

  await app.register(identityRoutes, { prefix: '/api/v1/auth', authRateLimitMax });
  await app.register(tenancyRoutes, { prefix: '/api/v1/tenants' });

  return app;
}
