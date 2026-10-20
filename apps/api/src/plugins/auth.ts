import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../lib/http-error.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
/** The platform console has its own login: own cookie, sent only to console routes. */
export const CONSOLE_COOKIE = 'console_sid';
export const CONSOLE_PATH = '/api/v1/admin';
export const CONSOLE_SESSION_HOURS = 12;
const isConsole = (req: FastifyRequest) => req.url.startsWith(CONSOLE_PATH);

export interface SessionUser {
  id: string;
  /** The login identity. Null only for users from before email login (they must add one). */
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  fullName: string;
}

export const sessionUser = (row: {
  id: string;
  email: string | null;
  email_verified_at: Date | null;
  phone: string | null;
  full_name: string;
}): SessionUser => ({
  id: row.id,
  email: row.email,
  emailVerified: row.email !== null && row.email_verified_at !== null,
  phone: row.phone,
  fullName: row.full_name,
});

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    /** Set with `user`: when this login happened, and whether the user is a platform admin. */
    authSession: { createdAt: Date; isPlatformAdmin: boolean } | null;
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
  app.decorateRequest('authSession', null);

  // Console routes read only the console cookie and accept only the platform admin; every other
  // route reads only the app cookie and never accepts the platform admin. The two never mix.
  app.addHook('onRequest', async (req) => {
    const forConsole = isConsole(req);
    const token = req.cookies[forConsole ? CONSOLE_COOKIE : SESSION_COOKIE];
    if (!token) return;
    const row = await app
      .db('auth_sessions as s')
      .join('users as u', 'u.id', 's.user_id')
      .where('s.token_hash', hashToken(token))
      .whereNull('s.revoked_at')
      .where('s.expires_at', '>', app.db.fn.now())
      .where('u.status', 'active')
      .where('u.is_platform_admin', forConsole)
      .first(
        'u.id',
        'u.email',
        'u.email_verified_at',
        'u.phone',
        'u.full_name',
        'u.is_platform_admin',
        's.created_at',
      );
    if (!row) return;
    req.user = sessionUser(row);
    req.authSession = { createdAt: row.created_at, isPlatformAdmin: row.is_platform_admin };
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.user) throw new HttpError(401, 'unauthenticated', 'Login required');
  });

  app.decorate('startSession', async (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const forConsole = isConsole(req);
    const token = randomBytes(32).toString('base64url');
    const hours = forConsole ? CONSOLE_SESSION_HOURS : SESSION_DAYS * 24;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    await app.db('auth_sessions').insert({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
      ip: req.ip,
      user_agent: req.headers['user-agent']?.slice(0, 300) ?? null,
    });
    reply.setCookie(forConsole ? CONSOLE_COOKIE : SESSION_COOKIE, token, {
      ...cookieOptions,
      ...(forConsole && { path: CONSOLE_PATH, sameSite: 'strict' as const }),
      expires: expiresAt,
    });
  });

  app.decorate('endSession', async (req: FastifyRequest, reply: FastifyReply) => {
    const forConsole = isConsole(req);
    const token = req.cookies[forConsole ? CONSOLE_COOKIE : SESSION_COOKIE];
    if (token) {
      await app
        .db('auth_sessions')
        .where('token_hash', hashToken(token))
        .whereNull('revoked_at')
        .update({ revoked_at: app.db.fn.now() });
    }
    if (forConsole) reply.clearCookie(CONSOLE_COOKIE, { ...cookieOptions, path: CONSOLE_PATH });
    else reply.clearCookie(SESSION_COOKIE, cookieOptions);
  });
});
