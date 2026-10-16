import { withTenant } from '@lms/db';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Knex } from 'knex';
import { HttpError, notFound } from '../lib/http-error.js';

export const ROLES = ['owner', 'admin', 'teacher', 'receptionist', 'student', 'parent'] as const;
export type Role = (typeof ROLES)[number];

export interface TenantContext {
  id: string;
  membershipId: string;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext | null;
    /** Run queries as this tenant + user. Only available after loadTenant. */
    withTenant<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
  }
  interface FastifyInstance {
    loadTenant: (req: FastifyRequest) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest) => Promise<void>;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default fp(async (app) => {
  app.decorateRequest('tenant', null);
  app.decorateRequest('withTenant', function <
    T,
  >(this: FastifyRequest, work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    if (!this.tenant || !this.user) throw new Error('withTenant called before loadTenant');
    return withTenant(app.db, { tenantId: this.tenant.id, userId: this.user.id }, work);
  });

  // For routes under /tenants/:tenantId. The URL tenant is only a *requested* context:
  // it becomes authority only after an active membership is found for this user.
  app.decorate('loadTenant', async (req: FastifyRequest) => {
    await app.requireAuth(req);
    const userId = req.user!.id;
    const { tenantId } = req.params as { tenantId?: string };
    if (!tenantId || !UUID.test(tenantId)) throw notFound();

    const membership = await withTenant(app.db, { tenantId, userId }, async (trx) => {
      const m = await trx('tenant_memberships')
        .where({ tenant_id: tenantId, user_id: userId, status: 'active' })
        .first('id');
      if (!m) return null;
      const roles = await trx('membership_roles').where({ membership_id: m.id }).pluck('role');
      return { id: m.id as string, roles: roles as Role[] };
    });
    if (!membership) throw notFound();
    req.tenant = { id: tenantId, membershipId: membership.id, roles: membership.roles };
  });

  app.decorate('requireRole', (...allowed: Role[]) => async (req: FastifyRequest) => {
    if (!req.tenant?.roles.some((r) => allowed.includes(r))) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
  });
});
