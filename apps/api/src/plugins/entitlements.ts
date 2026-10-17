import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  accountSuspended,
  featureLocked,
  getEntitlements,
  type Feature,
} from '../modules/billing/index.js';

type AccountAccess = Awaited<ReturnType<typeof getEntitlements>>;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Refuse with 403 feature_locked when the account's plan does not include this feature. */
    feature?: Feature;
  }
  interface FastifyRequest {
    /** The account's state and features, loaded once per request. Only after loadTenant. */
    entitlements(): Promise<AccountAccess>;
    requireFeature(feature: Feature): Promise<void>;
  }
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const memo = Symbol('entitlements');

/**
 * For every route under /tenants/:tenantId, after its own preHandlers (loadTenant, roles):
 * a suspended account is read-only (SAAS_PLAN §5.2 rule 1), then `config.feature` is checked.
 * No write is exempt: paying is a bank transfer plus WhatsApp, and every export is a GET.
 */
export default fp(async (app) => {
  app.decorateRequest('entitlements', function (this: FastifyRequest) {
    const req = this as FastifyRequest & { [memo]?: Promise<AccountAccess> };
    req[memo] ??= req.withTenant((trx) =>
      getEntitlements(trx, req.tenant!.id, { withUsage: false }),
    );
    return req[memo];
  });
  app.decorateRequest('requireFeature', async function (this: FastifyRequest, feature: Feature) {
    if (!(await this.entitlements()).features[feature]) throw featureLocked(feature);
  });

  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/v1/tenants/:tenantId')) return;
    const feature = route.config?.feature;
    const methods = [route.method].flat();
    const gate = async (req: FastifyRequest) => {
      if (!req.tenant) throw new Error(`loadTenant must run before the gate on ${route.url}`);
      if (!READS.has(req.method) && !(await req.entitlements()).writable) {
        throw accountSuspended();
      }
      if (feature) await req.requireFeature(feature);
    };
    if (!feature && methods.every((m) => READS.has(m))) return;
    route.preHandler = [route.preHandler ?? []].flat().concat(gate);
  });
});
