import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { HttpError } from '../../lib/http-error.js';
import { sessionUser } from '../../plugins/auth.js';
import { verifyPassword } from '../identity/service.js';

// Console login, /api/v1/admin/auth. Separate from the app login: only the platform owner can log
// in here, and the session (console_sid cookie) works on console routes only.

const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export default async function consoleAuthRoutes(
  app: FastifyInstance,
  { authRateLimitMax }: { authRateLimitMax: number },
) {
  const limited = { config: { rateLimit: { max: authRateLimitMax, timeWindow: '1 minute' } } };

  app.post('/login', limited, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const user = await app
      .db('users')
      .whereRaw('lower(email) = ?', [body.email])
      .where({ is_platform_admin: true, status: 'active' })
      .whereNotNull('email_verified_at')
      .first('id', 'email', 'email_verified_at', 'phone', 'full_name', 'password_hash');
    // Same answer (and timing) as a wrong password.
    if (!(await verifyPassword(user?.password_hash, body.password)) || !user) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    await app.startSession(req, reply, user.id);
    return { user: sessionUser(user) };
  });

  app.post('/logout', async (req, reply) => {
    await app.endSession(req, reply);
    return reply.status(204).send();
  });

  app.get('/me', { preHandler: app.requirePlatformAdmin }, async (req) => ({ user: req.user }));
}
