import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Knex } from 'knex';
import attendanceRoutes from './modules/attendance/routes.js';
import billingRoutes from './modules/billing/routes.js';
import classRoutes from './modules/classes/routes.js';
import feeRoutes from './modules/fees/routes.js';
import identityRoutes from './modules/identity/routes.js';
import platformRoutes from './modules/platform/routes.js';
import portalRoutes from './modules/portal/routes.js';
import quizRoutes from './modules/quizzes/routes.js';
import reportRoutes from './modules/reports/routes.js';
import slipRoutes from './modules/slips/routes.js';
import { inviteRoutes, staffRoutes } from './modules/staff/routes.js';
import studentRoutes from './modules/students/routes.js';
import tenancyRoutes from './modules/tenancy/routes.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import entitlementsPlugin from './plugins/entitlements.js';
import errorsPlugin from './plugins/errors.js';
import platformAdminPlugin from './plugins/platform-admin.js';
import tenantPlugin from './plugins/tenant.js';

export interface AppOptions {
  db: Knex;
  secureCookies: boolean;
  /** Login/signup attempts per IP per minute. */
  authRateLimitMax?: number;
  /** Platform console changes per IP per minute. */
  adminRateLimitMax?: number;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({
  db,
  secureCookies,
  authRateLimitMax = 10,
  adminRateLimitMax = 30,
  logger = true,
}: AppOptions) {
  // trustProxy: nginx on the same host sets X-Forwarded-For (needed for rate limits + session IP).
  const app = Fastify({ logger, trustProxy: '127.0.0.1' });

  await app.register(errorsPlugin);
  await app.register(dbPlugin, { db });
  await app.register(authPlugin, { secureCookies });
  await app.register(tenantPlugin);
  await app.register(platformAdminPlugin);
  // Before the routes: it hooks onRoute to gate every route under /tenants/:tenantId.
  await app.register(entitlementsPlugin);
  await app.register(rateLimit, { global: false });

  app.get('/api/health', async () => {
    await db.raw('select 1');
    return { status: 'ok' };
  });

  await app.register(identityRoutes, { prefix: '/api/v1/auth', authRateLimitMax });
  await app.register(tenancyRoutes, { prefix: '/api/v1/tenants' });
  await app.register(studentRoutes, { prefix: '/api/v1/tenants/:tenantId/students' });
  await app.register(classRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(staffRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(attendanceRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(feeRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(portalRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(quizRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(slipRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(billingRoutes, { prefix: '/api/v1/tenants/:tenantId' });
  await app.register(reportRoutes, { prefix: '/api/v1/tenants/:tenantId/reports' });
  await app.register(inviteRoutes, { prefix: '/api/v1/invites' });
  await app.register(platformRoutes, { prefix: '/api/v1/admin', adminRateLimitMax });

  return app;
}
