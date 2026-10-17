import type { Knex } from 'knex';

// Phase 5 of docs/EMAIL_AUTH_PLAN.md: email is the only login. Run only when the console shows
// no users still logging in by phone; otherwise this refuses, so nobody is locked out.
// Disabled users may keep no email (they cannot log in anyway).

export async function up(knex: Knex): Promise<void> {
  const [{ n: phoneOnly }] = await knex('users')
    .where({ status: 'active' })
    .where((w) => w.whereNull('email').orWhereNull('email_verified_at'))
    .count({ n: '*' });
  const [{ n: unclaimable }] = await knex('accounts')
    .whereNull('owner_user_id')
    .whereNull('owner_email')
    .count({ n: '*' });
  if (Number(phoneOnly) > 0 || Number(unclaimable) > 0) {
    throw new Error(
      `019: ${phoneOnly} active user(s) have no verified email and ${unclaimable} unclaimed ` +
        'account(s) have no owner email. Wait until users add one (console → Accounts) and set ' +
        'the owner email of those accounts (console → account → Manage), then deploy again.',
    );
  }

  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_active_email_verified
    CHECK (status <> 'active' OR (email IS NOT NULL AND email_verified_at IS NOT NULL))`);
  await knex.raw(`ALTER TABLE accounts ADD CONSTRAINT accounts_unclaimed_owner_email
    CHECK (owner_user_id IS NOT NULL OR owner_email IS NOT NULL)`);

  // Pending invites from before email login (phone only) can no longer be accepted.
  // tenant_invites has forced RLS: revoke tenant by tenant, as 013 does.
  const tenants: { id: string }[] = await knex('tenants').select('id');
  for (const t of tenants) {
    await knex.raw("SELECT set_config('app.tenant_id', ?, true)", [t.id]);
    await knex('tenant_invites')
      .where({ tenant_id: t.id, status: 'pending' })
      .whereNull('email')
      .update({ status: 'revoked', updated_at: knex.fn.now() });
  }
  await knex.raw("SELECT set_config('app.tenant_id', '', true)");
  await knex.raw(`ALTER TABLE tenant_invites ADD CONSTRAINT tenant_invites_pending_email
    CHECK (status <> 'pending' OR email IS NOT NULL)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE tenant_invites DROP CONSTRAINT tenant_invites_pending_email');
  await knex.raw('ALTER TABLE accounts DROP CONSTRAINT accounts_unclaimed_owner_email');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_active_email_verified');
}
