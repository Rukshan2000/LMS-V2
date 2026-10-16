import { setContext } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, isUniqueViolation } from '../../lib/http-error.js';
import { planUsage } from '../../lib/plans.js';

const createTenantBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, '3–60 characters: a–z, 0–9 and -'),
});

export default async function tenancyRoutes(app: FastifyInstance) {
  // Create an institute: tenant + owner membership + first branch, all or nothing.
  app.post('/', { preHandler: app.requireAuth }, async (req, reply) => {
    const body = createTenantBody.parse(req.body);
    const userId = req.user!.id;
    try {
      const tenant = await app.db.transaction(async (trx) => {
        const [t] = await trx('tenants')
          .insert({ name: body.name, slug: body.slug })
          .returning(['id', 'slug', 'name', 'status', 'plan']);
        // The new tenant is now the context for its own tenant-owned rows (RLS WITH CHECK).
        await setContext(trx, { tenantId: t.id, userId });
        const [m] = await trx('tenant_memberships')
          .insert({ tenant_id: t.id, user_id: userId })
          .returning('id');
        await trx('membership_roles').insert({
          tenant_id: t.id,
          membership_id: m.id,
          role: 'owner',
        });
        await trx('branches').insert({ tenant_id: t.id, name: 'Main' });
        return t;
      });
      return reply.status(201).send({ tenant, roles: ['owner'] });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, 'slug_taken', 'This institute link is already taken');
      }
      throw err;
    }
  });

  // Everything under /:tenantId requires an active membership in that tenant.
  app.register(async (scoped) => {
    scoped.addHook('preHandler', app.loadTenant);

    scoped.get('/:tenantId', async (req) => {
      const tenant = await app
        .db('tenants')
        .where({ id: req.tenant!.id })
        .first('id', 'slug', 'name', 'status', 'plan');
      const usage = await req.withTenant((trx) => planUsage(trx, req.tenant!.id));
      return { tenant, roles: req.tenant!.roles, usage };
    });

    // Staff list for pickers (e.g. choosing a class teacher).
    scoped.get(
      '/:tenantId/members',
      { preHandler: app.requireRole('owner', 'admin') },
      async (req) => ({
        members: await req.withTenant((trx) =>
          trx('tenant_memberships as m')
            .join('users as u', 'u.id', 'm.user_id')
            .where('m.status', 'active')
            // Staff only: parents and students are members too (portal).
            .whereExists((q) =>
              q
                .from('membership_roles as r')
                .whereRaw('r.membership_id = m.id')
                .whereIn('r.role', ['owner', 'admin', 'teacher', 'receptionist']),
            )
            .orderBy('u.full_name')
            .select(
              'm.id as membershipId',
              'u.full_name as fullName',
              'u.phone',
              trx.raw(
                `ARRAY(SELECT r.role FROM membership_roles r WHERE r.membership_id = m.id ORDER BY r.role) AS roles`,
              ),
            ),
        ),
      }),
    );

    scoped.get(
      '/:tenantId/branches',
      { preHandler: app.requireRole('owner', 'admin') },
      async (req) => ({
        branches: await req.withTenant((trx) =>
          trx('branches').orderBy('name').select('id', 'name'),
        ),
      }),
    );
  });
}
