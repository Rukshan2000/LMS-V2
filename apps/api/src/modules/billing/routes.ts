import type { FastifyInstance } from 'fastify';
import { getBilling } from './service.js';

/** Customer billing (SAAS_PLAN §6.4, §7.6). Prefix /api/v1/tenants/:tenantId */
export default async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);

  app.get('/billing', { preHandler: app.requireRole('owner', 'admin') }, async (req) =>
    req.withTenant((trx) => getBilling(trx, req.tenant!.id)),
  );
}
