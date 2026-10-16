import { withUser } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, isUniqueViolation } from '../../lib/http-error.js';
import { normalizePhone } from '../../lib/phone.js';
import { hashPassword, verifyPassword } from './service.js';

const signupBody = z.object({
  phone: z.string().min(9).max(20),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().min(1).max(200),
});
const loginBody = z.object({
  phone: z.string().min(9).max(20),
  password: z.string().min(1).max(200),
});

export default async function identityRoutes(
  app: FastifyInstance,
  { authRateLimitMax }: { authRateLimitMax: number },
) {
  const rateLimit = { rateLimit: { max: authRateLimitMax, timeWindow: '1 minute' } };

  app.post('/signup', { config: rateLimit }, async (req, reply) => {
    const body = signupBody.parse(req.body);
    const phone = normalizePhone(body.phone);
    let user;
    try {
      [user] = await app
        .db('users')
        .insert({
          phone,
          full_name: body.fullName,
          password_hash: await hashPassword(body.password),
        })
        .returning(['id', 'phone', 'full_name']);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, 'phone_taken', 'This phone number is already registered');
      }
      throw err;
    }
    await app.startSession(req, reply, user.id);
    return reply
      .status(201)
      .send({ user: { id: user.id, phone: user.phone, fullName: user.full_name } });
  });

  app.post('/login', { config: rateLimit }, async (req, reply) => {
    const body = loginBody.parse(req.body);
    let phone: string | undefined;
    try {
      phone = normalizePhone(body.phone);
    } catch {
      // Same answer as a wrong password.
    }
    const user = phone
      ? await app
          .db('users')
          .where({ phone, status: 'active' })
          .first('id', 'phone', 'full_name', 'password_hash')
      : undefined;
    if (!(await verifyPassword(user?.password_hash, body.password)) || !user) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong phone number or password');
    }
    await app.startSession(req, reply, user.id);
    return { user: { id: user.id, phone: user.phone, fullName: user.full_name } };
  });

  app.post('/logout', async (req, reply) => {
    await app.endSession(req, reply);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user!;
    const tenants = await withUser(app.db, user.id, (trx) =>
      trx('tenant_memberships as m')
        .join('tenants as t', 't.id', 'm.tenant_id')
        .where({ 'm.user_id': user.id, 'm.status': 'active' })
        .orderBy('t.name')
        .select('t.id', 't.slug', 't.name', 't.status'),
    );
    return { user, tenants };
  });
}
