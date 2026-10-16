import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../lib/http-error.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  phone: string;
  fullName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    startSession: (req: FastifyRequest, reply: FastifyReply, userId: string) => Promise<void>;
    endSession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export default fp<{ secureCookies: boolean }>(async (app, { secureCookies }) => {
  await app.register(cookie);
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
  };

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const row = await app
      .db('auth_sessions as s')
      .join('users as u', 'u.id', 's.user_id')
      .where('s.token_hash', hashToken(token))
      .whereNull('s.revoked_at')
      .where('s.expires_at', '>', app.db.fn.now())
      .where('u.status', 'active')
      .first('u.id', 'u.phone', 'u.full_name');
    if (row) req.user = { id: row.id, phone: row.phone, fullName: row.full_name };
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.user) throw new HttpError(401, 'unauthenticated', 'Login required');
  });

  app.decorate('startSession', async (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await app.db('auth_sessions').insert({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      ip: req.ip,
      user_agent: req.headers['user-agent']?.slice(0, 300) ?? null,
    });
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  });

  app.decorate('endSession', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      await app
        .db('auth_sessions')
        .where('token_hash', hashToken(token))
        .whereNull('revoked_at')
        .update({ revoked_at: app.db.fn.now() });
    }
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
  });
});
