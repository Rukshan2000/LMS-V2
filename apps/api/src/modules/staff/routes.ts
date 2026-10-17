import { createHash, randomBytes } from 'node:crypto';
import { withTenant } from '@lms/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { HttpError, notFound } from '../../lib/http-error.js';
import { inviteMail } from '../../lib/mail-templates.js';
import { assertAccountWritable, assertCanAddHead, assertFeature } from '../billing/index.js';

const INVITE_DAYS = 14;
const STAFF_ROLES = ['admin', 'teacher', 'receptionist'] as const;
const uuid = z.uuid();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const newInviteToken = () => {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
  };
};

/** Emails the invite link. false when SMTP failed; the caller still returns the code to copy. */
export async function mailInvite(
  app: FastifyInstance,
  tenantId: string,
  token: string,
  invite: { email: string; fullName: string; role: string },
) {
  const tenant = await app.db('tenants').where({ id: tenantId }).first('name');
  const url = `${app.appUrl}/join/${tenantId}.${token}`;
  return app.sendMail(inviteMail(invite.email, { ...invite, tenantName: tenant.name, url }));
}

/** "<tenantId>.<token>" → parts, or 404 for anything malformed. */
function parseCode(req: FastifyRequest) {
  const { code } = req.params as { code: string };
  const [tenantId, token, extra] = (code ?? '').split('.');
  if (
    extra !== undefined ||
    !uuid.safeParse(tenantId).success ||
    !/^[\w-]{43}$/.test(token ?? '')
  ) {
    throw notFound();
  }
  return { tenantId: tenantId!, tokenHash: hash(token!) };
}

/** Tenant-scoped: owners/admins invite and remove staff. Prefix /api/v1/tenants/:tenantId */
export async function staffRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const managers = app.requireRole('owner', 'admin');

  app.get('/invites', { preHandler: managers }, async (req) => ({
    invites: await req.withTenant((trx) =>
      trx('tenant_invites')
        .where({ status: 'pending' })
        .whereNull('student_id')
        .where('expires_at', '>', trx.fn.now())
        .orderBy('created_at', 'desc')
        .select('id', 'full_name as fullName', 'email', 'phone', 'role', 'expires_at as expiresAt'),
    ),
  }));

  app.post('/invites', { preHandler: managers }, async (req, reply) => {
    const body = z
      .object({
        fullName: z.string().trim().min(1).max(200),
        email: emailSchema,
        role: z.enum(STAFF_ROLES),
      })
      .parse(req.body);
    const { email } = body;
    const { token, tokenHash, expiresAt } = newInviteToken();
    const tenantId = req.tenant!.id;
    const invite = await req.withTenant(async (trx) => {
      const member = await trx('tenant_memberships as m')
        .join('users as u', 'u.id', 'm.user_id')
        .join('membership_roles as r', 'r.membership_id', 'm.id')
        .whereRaw('lower(u.email) = ?', [email])
        .where({ 'm.status': 'active' })
        .whereIn('r.role', ['owner', ...STAFF_ROLES])
        .first('m.id');
      if (member) throw new HttpError(409, 'already_member', 'This person is already staff here');
      // Early refusal at the cap; accept checks again (pending invites are not counted).
      await assertCanAddHead(trx, tenantId, body.role);
      // A new invite for the same email replaces any older pending one.
      await trx('tenant_invites')
        .where({ email, status: 'pending' })
        .whereNull('student_id')
        .update({ status: 'revoked', updated_at: trx.fn.now() });
      const [row] = await trx('tenant_invites')
        .insert({
          tenant_id: tenantId,
          full_name: body.fullName,
          email,
          role: body.role,
          token_hash: tokenHash,
          expires_at: expiresAt,
          invited_by_membership_id: req.tenant!.membershipId,
        })
        .returning(['id', 'full_name as fullName', 'email', 'role', 'expires_at as expiresAt']);
      return row;
    });
    const emailSent = await mailInvite(app, tenantId, token, invite);
    // The token is shown once (to copy as a fallback); only its hash is stored.
    return reply.status(201).send({ invite, code: `${tenantId}.${token}`, emailSent });
  });

  // New link (the old one stops working) and a fresh 14 days, mailed again.
  app.post('/invites/:inviteId/resend', { preHandler: managers }, async (req) => {
    const { inviteId } = req.params as { inviteId: string };
    if (!uuid.safeParse(inviteId).success) throw notFound();
    const { token, tokenHash, expiresAt } = newInviteToken();
    const tenantId = req.tenant!.id;
    const invite = await req.withTenant(async (trx) => {
      const [row] = await trx('tenant_invites')
        .where({ id: inviteId, status: 'pending' })
        .whereNull('student_id')
        .whereNotNull('email')
        .update({ token_hash: tokenHash, expires_at: expiresAt, updated_at: trx.fn.now() })
        .returning(['email', 'full_name as fullName', 'role']);
      return row;
    });
    if (!invite) throw notFound();
    return {
      code: `${tenantId}.${token}`,
      emailSent: await mailInvite(app, tenantId, token, invite),
    };
  });

  app.delete('/invites/:inviteId', { preHandler: managers }, async (req) => {
    const { inviteId } = req.params as { inviteId: string };
    if (!uuid.safeParse(inviteId).success) throw notFound();
    const n = await req.withTenant((trx) =>
      trx('tenant_invites')
        .where({ id: inviteId, status: 'pending' })
        .whereNull('student_id')
        .update({ status: 'revoked', updated_at: trx.fn.now() }),
    );
    if (!n) throw notFound();
    return { revoked: true };
  });

  // Remove a staff member's access. Owners cannot be removed here, and nobody removes themselves.
  app.delete('/members/:membershipId', { preHandler: managers }, async (req) => {
    const { membershipId } = req.params as { membershipId: string };
    if (!uuid.safeParse(membershipId).success) throw notFound();
    if (membershipId === req.tenant!.membershipId) {
      throw new HttpError(400, 'cannot_remove_self', 'You cannot remove yourself');
    }
    await req.withTenant(async (trx) => {
      const roles = await trx('membership_roles')
        .where({ membership_id: membershipId })
        .pluck('role');
      if (roles.length === 0) throw notFound();
      if (roles.includes('owner')) {
        throw new HttpError(403, 'cannot_remove_owner', 'The owner cannot be removed');
      }
      await trx('tenant_memberships')
        .where({ id: membershipId })
        .update({ status: 'disabled', updated_at: trx.fn.now() });
    });
    return { removed: true };
  });
}

/** Public invite link endpoints. Prefix /api/v1/invites */
export async function inviteRoutes(app: FastifyInstance) {
  const rateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  const findInvite = (trx: Parameters<Parameters<typeof withTenant>[2]>[0], tokenHash: string) =>
    trx('tenant_invites as i')
      .join('tenants as t', 't.id', 'i.tenant_id')
      .where({ 'i.token_hash': tokenHash, 'i.status': 'pending' })
      .where('i.expires_at', '>', trx.fn.now())
      .first(
        'i.id',
        'i.full_name as fullName',
        'i.email',
        'i.role',
        'i.student_id as studentId',
        't.id as tenantId',
        't.name as tenantName',
      );

  app.get('/:code', { config: rateLimit }, async (req) => {
    const { tenantId, tokenHash } = parseCode(req);
    const invite = await withTenant(app.db, { tenantId }, (trx) => findInvite(trx, tokenHash));
    if (!invite) throw notFound();
    return { invite: { ...invite, id: undefined, studentId: undefined } };
  });

  app.post('/:code/accept', { config: rateLimit, preHandler: app.requireAuth }, async (req) => {
    const { tenantId, tokenHash } = parseCode(req);
    const user = req.user!;
    await withTenant(app.db, { tenantId, userId: user.id }, async (trx) => {
      const invite = await findInvite(trx, tokenHash).forUpdate('i');
      if (!invite) throw notFound();
      // Only the user who proved that email (every login email is verified).
      if (invite.email !== user.email) {
        throw new HttpError(403, 'wrong_email', 'This invite is for a different email address');
      }
      // Portal invites need the portal feature. Accepting adds a billable head only if the user
      // does not already hold this role here (a parent of a second child is not a new head), and
      // student logins are never billed (students are billed as records).
      if (invite.studentId) await assertFeature(trx, tenantId, 'portal');
      const holdsRole = await trx('tenant_memberships as m')
        .join('membership_roles as r', 'r.membership_id', 'm.id')
        .where({ 'm.user_id': user.id, 'm.status': 'active', 'r.role': invite.role })
        .first('m.id');
      if (!holdsRole && invite.role !== 'student') {
        await assertCanAddHead(trx, tenantId, invite.role);
      } else {
        await assertAccountWritable(trx, tenantId);
      }
      const [membership] = await trx('tenant_memberships')
        .insert({ tenant_id: tenantId, user_id: user.id, status: 'active' })
        .onConflict(['tenant_id', 'user_id'])
        .merge({ status: 'active', updated_at: trx.fn.now() })
        .returning('id');
      await trx('membership_roles')
        .insert({ tenant_id: tenantId, membership_id: membership.id, role: invite.role })
        .onConflict(['membership_id', 'role'])
        .ignore();
      if (invite.studentId) {
        await trx('portal_access')
          .insert({
            tenant_id: tenantId,
            membership_id: membership.id,
            student_id: invite.studentId,
          })
          .onConflict(['membership_id', 'student_id'])
          .ignore();
      }
      await trx('tenant_invites')
        .where({ id: invite.id })
        .update({ status: 'accepted', accepted_by_user_id: user.id, updated_at: trx.fn.now() });
    });
    return { tenantId };
  });
}
