import { createHash, randomBytes } from 'node:crypto';
import { withTenant } from '@lms/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { normalizePhone } from '../../lib/phone.js';

const INVITE_DAYS = 14;
const STAFF_ROLES = ['admin', 'teacher', 'receptionist'] as const;
const uuid = z.uuid();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
        .select('id', 'full_name as fullName', 'phone', 'role', 'expires_at as expiresAt'),
    ),
  }));

  app.post('/invites', { preHandler: managers }, async (req, reply) => {
    const body = z
      .object({
        fullName: z.string().trim().min(1).max(200),
        phone: z.string().min(9).max(20),
        role: z.enum(STAFF_ROLES),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone);
    const token = randomBytes(32).toString('base64url');
    const tenantId = req.tenant!.id;
    const invite = await req.withTenant(async (trx) => {
      const member = await trx('tenant_memberships as m')
        .join('users as u', 'u.id', 'm.user_id')
        .join('membership_roles as r', 'r.membership_id', 'm.id')
        .where({ 'u.phone': phone, 'm.status': 'active' })
        .whereIn('r.role', ['owner', ...STAFF_ROLES])
        .first('m.id');
      if (member) throw new HttpError(409, 'already_member', 'This person is already staff here');
      // A new invite for the same phone replaces any older pending one.
      await trx('tenant_invites')
        .where({ phone, status: 'pending' })
        .whereNull('student_id')
        .update({ status: 'revoked', updated_at: trx.fn.now() });
      const [row] = await trx('tenant_invites')
        .insert({
          tenant_id: tenantId,
          full_name: body.fullName,
          phone,
          role: body.role,
          token_hash: hash(token),
          expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
          invited_by_membership_id: req.tenant!.membershipId,
        })
        .returning(['id', 'full_name as fullName', 'phone', 'role', 'expires_at as expiresAt']);
      return row;
    });
    // The token is shown once; only its hash is stored.
    return reply.status(201).send({ invite, code: `${tenantId}.${token}` });
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
        'i.phone',
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
      if (invite.phone !== user.phone) {
        throw new HttpError(403, 'wrong_phone', 'This invite is for a different mobile number');
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
