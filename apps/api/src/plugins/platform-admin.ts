import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError, notFound } from '../lib/http-error.js';

/** Admin routes need a login younger than this (docs/SAAS_PLAN.md §10.1). */
export const ADMIN_SESSION_HOURS = 12;

declare module 'fastify' {
  interface FastifyInstance {
    requirePlatformAdmin: (req: FastifyRequest) => Promise<void>;
  }
}

export default fp(async (app) => {
  // Everyone but a platform admin gets the same 404 as an unknown URL, so the console's
  // routes cannot be discovered. An admin with an old login is asked to log in again.
  app.decorate('requirePlatformAdmin', async (req: FastifyRequest) => {
    if (!req.user || !req.authSession?.isPlatformAdmin) throw notFound();
    const age = Date.now() - new Date(req.authSession.createdAt).getTime();
    if (age > ADMIN_SESSION_HOURS * 3600_000) {
      throw new HttpError(401, 'reauth_required', 'Log in again to use the platform console');
    }
  });
});
