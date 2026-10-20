import { withUser } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { HttpError, isUniqueViolation } from '../../lib/http-error.js';
import type { Mail } from '../../lib/mail.js';
import { alreadyRegisteredMail, emailChangedMail, otpMail } from '../../lib/mail-templates.js';
import { parsePhone } from '../../lib/phone.js';
import { sessionUser } from '../../plugins/auth.js';
import { consumeOtp, issueOtp } from './otp.js';
import { hashPassword, verifyPassword } from './service.js';

// Email + password login; every email is proven by a 6-digit code (docs/EMAIL_AUTH_PLAN.md).

const password = z.string().min(8).max(200);
const code = z.string().trim().max(10);
const emailOnly = z.object({ email: emailSchema });

const signupBody = z.object({
  email: emailSchema,
  code,
  password,
  fullName: z.string().trim().min(1).max(200),
  // Optional contact mobile (WhatsApp). Not a login key.
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const p = parsePhone(v);
      if (!p) ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return p;
    }),
  // Checkbox "on" from the form, or true from JSON clients.
  acceptPrivacy: z.union([z.literal(true), z.literal('on')], {
    error: 'privacy_not_accepted',
  }),
});
// identifier: an email, or (until every user has one) the phone of a user without a verified email.
const loginBody = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});
const resetBody = z.object({ email: emailSchema, code, password });
const changeBody = z.object({ email: emailSchema, password: z.string().max(200).optional() });
const confirmBody = z.object({ email: emailSchema, code });

const USER_COLUMNS = ['id', 'email', 'email_verified_at', 'phone', 'full_name'];

function duplicate(err: unknown): never {
  if (isUniqueViolation(err)) {
    if ((err as { constraint?: string }).constraint === 'users_phone_unique') {
      throw new HttpError(409, 'phone_taken', 'This phone number is already registered');
    }
    throw new HttpError(409, 'email_taken', 'This email is already registered');
  }
  throw err;
}

export default async function identityRoutes(
  app: FastifyInstance,
  { authRateLimitMax }: { authRateLimitMax: number },
) {
  const rateLimit = { rateLimit: { max: authRateLimitMax, timeWindow: '1 minute' } };
  const limited = { config: rateLimit };
  const authed = { config: rateLimit, preHandler: app.requireAuth };

  const send = async (mail: Mail) => {
    if (!(await app.sendMail(mail))) {
      throw new HttpError(503, 'mail_unavailable', 'Could not send the email. Try again shortly');
    }
  };
  const findByEmail = (email: string) =>
    app
      .db('users')
      .whereRaw('lower(email) = ?', [email])
      .first([...USER_COLUMNS, 'status', 'password_hash', 'is_platform_admin']);

  // Step 1: mail a code. Same answer whether or not the email is registered; a registered
  // address gets "you already have an account" instead of a code.
  app.post('/signup/start', limited, async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    const otp = await issueOtp(app.db, { email, purpose: 'signup' });
    const existing = await findByEmail(email);
    await send(existing ? alreadyRegisteredMail(email, app.appUrl) : otpMail(email, otp, 'signup'));
    return reply.status(202).send({ sent: true });
  });

  // Step 2: the code proves the email; only now does the user exist.
  app.post('/signup/verify', limited, async (req, reply) => {
    const body = signupBody.parse(req.body);
    await consumeOtp(app.db, { email: body.email, purpose: 'signup', code: body.code });
    let row;
    try {
      [row] = await app
        .db('users')
        .insert({
          email: body.email,
          email_verified_at: app.db.fn.now(),
          phone: body.phone,
          full_name: body.fullName,
          password_hash: await hashPassword(body.password),
          privacy_accepted_at: app.db.fn.now(),
        })
        .returning(USER_COLUMNS);
    } catch (err) {
      duplicate(err);
    }
    await app.startSession(req, reply, row.id);
    return reply.status(201).send({ user: sessionUser(row) });
  });

  app.post('/login', limited, async (req, reply) => {
    const body = loginBody.parse(req.body);
    let user;
    if (body.identifier.includes('@')) {
      user = await findByEmail(body.identifier.toLowerCase());
    } else {
      // Phone login only for users who have not verified an email yet (EMAIL_AUTH_PLAN §9).
      const phone = parsePhone(body.identifier);
      user = phone
        ? await app
            .db('users')
            .where({ phone })
            .where((w) => w.whereNull('email').orWhereNull('email_verified_at'))
            .first([...USER_COLUMNS, 'status', 'password_hash', 'is_platform_admin'])
        : undefined;
    }
    // The platform owner logs in only at the console (/admin/auth/login).
    if (user?.status !== 'active' || user.is_platform_admin) user = undefined;
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

  // Forgot password: a code goes only to a registered address; the answer is the same either way.
  app.post('/password/forgot', limited, async (req, reply) => {
    const { email } = emailOnly.parse(req.body);
    const otp = await issueOtp(app.db, { email, purpose: 'password_reset' });
    const user = await findByEmail(email);
    if (user?.status === 'active' && user.email_verified_at) {
      await send(otpMail(email, otp, 'password_reset'));
    }
    return reply.status(202).send({ sent: true });
  });

  app.post('/password/reset', limited, async (req, reply) => {
    const body = resetBody.parse(req.body);
    await consumeOtp(app.db, { email: body.email, purpose: 'password_reset', code: body.code });
    const user = await findByEmail(body.email);
    if (user?.status !== 'active') throw new HttpError(400, 'otp_invalid', 'Wrong or expired code');
    const passwordHash = await hashPassword(body.password);
    await app.db.transaction(async (trx) => {
      await trx('users')
        .where({ id: user.id })
        .update({ password_hash: passwordHash, updated_at: trx.fn.now() });
      // Whoever knew the old password is logged out everywhere.
      await trx('auth_sessions')
        .where({ user_id: user.id })
        .whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
    });
    await app.startSession(req, reply, user.id);
    return { user: sessionUser(user) };
  });

  // Set or change the login email (also how a phone-only user adds one). Re-checks the password
  // when the account already has a verified email; the code goes to the new address.
  app.post('/email/change', authed, async (req, reply) => {
    const body = changeBody.parse(req.body);
    const user = req.user!;
    if (user.emailVerified) {
      const row = await app.db('users').where({ id: user.id }).first('password_hash');
      if (!(await verifyPassword(row.password_hash, body.password ?? ''))) {
        throw new HttpError(401, 'invalid_credentials', 'Wrong password');
      }
    }
    const taken = await findByEmail(body.email);
    if (taken && taken.id !== user.id) {
      throw new HttpError(409, 'email_taken', 'This email is already registered');
    }
    const otp = await issueOtp(app.db, {
      email: body.email,
      purpose: 'email_change',
      userId: user.id,
    });
    await send(otpMail(body.email, otp, 'email_change'));
    return reply.status(202).send({ sent: true });
  });

  app.post('/email/confirm', authed, async (req) => {
    const body = confirmBody.parse(req.body);
    const user = req.user!;
    await consumeOtp(app.db, {
      email: body.email,
      purpose: 'email_change',
      code: body.code,
      userId: user.id,
    });
    let row;
    try {
      [row] = await app
        .db('users')
        .where({ id: user.id })
        .update({
          email: body.email,
          email_verified_at: app.db.fn.now(),
          updated_at: app.db.fn.now(),
        })
        .returning(USER_COLUMNS);
    } catch (err) {
      duplicate(err);
    }
    if (user.emailVerified && user.email !== body.email) {
      await app.sendMail(emailChangedMail(user.email!, body.email));
    }
    return { user: sessionUser(row) };
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
