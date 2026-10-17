import type { Knex } from 'knex';

// SaaS accounts and per-head billing (docs/SAAS_PLAN.md §8, ADR 009).
// An account is the paying customer and owns 1..n institutes (tenants). All tables here are
// global (no tenant_id, no RLS), like tenants and users: they hold counts and money, never
// student data. Prices, caps and switches are data; the list of keys lives in the API's
// billing catalogue. tenants.plan / plan_expires_at stay until a later contract migration.

const STANDARD_VALUES = {
  'price.student': 100,
  'price.teacher': 2000,
  'price.parent': 50,
  'price.admin': 0,
  'price.receptionist': 0,
  'cap.institutes': 3,
  'feature.bank_slips': true,
  'feature.live_links': true,
  'feature.reports': true,
  'feature.student_import': true,
  'feature.portal': true,
};

const SETTINGS = {
  trial_days: 30,
  grace_days: 7,
  invoice_due_days: 7,
  // Applied to new self-service accounts as overrides that expire with the trial.
  trial_caps: { 'cap.students': 100, 'cap.teachers': 5, 'cap.institutes': 1 },
  support_whatsapp: null,
  bank_details: null,
};

/** Days of free use existing institutes get before per-head billing starts (ADR 009). */
const EXISTING_FREE_DAYS = 30;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('price_books', (t) => {
    t.string('key', 32).primary();
    t.string('name', 100).notNullable();
    t.jsonb('values').notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE price_books
    ADD CONSTRAINT price_books_key_format CHECK (key ~ '^[a-z0-9_-]{2,32}$')`);
  await knex.raw(
    'CREATE UNIQUE INDEX price_books_one_default ON price_books (is_default) WHERE is_default',
  );

  await knex.schema.createTable('platform_settings', (t) => {
    t.string('key', 64).primary();
    t.jsonb('value');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 200).notNullable();
    // Null until the person the platform admin created the account for signs up (claim by phone).
    t.uuid('owner_user_id').references('id').inTable('users');
    t.string('owner_phone', 15).notNullable();
    t.string('price_book', 32).notNullable().references('key').inTable('price_books');
    t.timestamp('trial_ends_at');
    t.timestamp('suspended_at');
    t.string('suspended_reason', 300);
    t.text('notes');
    t.uuid('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['owner_phone']);
  });
  await knex.raw(`ALTER TABLE accounts
    ADD CONSTRAINT accounts_owner_phone_digits CHECK (owner_phone ~ '^[0-9]{9,15}$')`);
  await knex.raw(
    'CREATE UNIQUE INDEX accounts_owner_unique ON accounts (owner_user_id) WHERE owner_user_id IS NOT NULL',
  );

  await knex.schema.createTable('account_overrides', (t) => {
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('key', 64).notNullable();
    t.jsonb('value');
    t.timestamp('expires_at');
    t.string('note', 300).notNullable();
    // Null = set by the system (e.g. trial caps), otherwise the platform admin.
    t.uuid('created_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['account_id', 'key']);
  });

  await knex.schema.createTable('subscription_invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts');
    t.string('number', 32).notNullable().unique();
    t.string('period', 7).notNullable();
    // Snapshot: head, peak, included, unit price, amount. Never recalculated.
    t.jsonb('lines').notNullable();
    t.decimal('total', 12, 2).notNullable();
    t.date('due_date').notNullable();
    t.string('status', 8).notNullable().defaultTo('open');
    t.uuid('generated_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'period']);
  });
  await knex.raw(`ALTER TABLE subscription_invoices
    ADD CONSTRAINT subscription_invoices_total_check CHECK (total >= 0),
    ADD CONSTRAINT subscription_invoices_period_format CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    ADD CONSTRAINT subscription_invoices_status_check CHECK (status IN ('open', 'paid', 'void'))`);

  await knex.schema.createTable('subscription_payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').notNullable().references('id').inTable('subscription_invoices');
    t.decimal('amount', 12, 2).notNullable();
    t.string('method', 16).notNullable().defaultTo('bank_transfer');
    t.string('reference', 100);
    t.uuid('client_ref').notNullable().unique();
    // Null = recorded by a payment provider webhook (later).
    t.uuid('recorded_by').references('id').inTable('users');
    t.timestamp('received_at').notNullable().defaultTo(knex.fn.now());
    t.index(['invoice_id']);
  });
  await knex.raw(`ALTER TABLE subscription_payments
    ADD CONSTRAINT subscription_payments_amount_check CHECK (amount > 0)`);

  await knex.schema.createTable('platform_audit', (t) => {
    t.bigIncrements('id');
    t.uuid('actor_user_id').notNullable().references('id').inTable('users');
    t.uuid('account_id').references('id').inTable('accounts');
    t.string('action', 64).notNullable();
    t.jsonb('before');
    t.jsonb('after');
    t.string('ip', 45);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['account_id', 'created_at']);
  });
  // Append-only for the app: default privileges granted it UPDATE/DELETE on every new table.
  await knex.raw(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
      WHERE table_name = 'platform_audit' AND grantee <> current_user
    LOOP EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit FROM %I', r.grantee);
    END LOOP; END $$`);

  await knex.schema.alterTable('users', (t) => {
    t.boolean('is_platform_admin').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('tenants', (t) => {
    t.uuid('account_id').references('id').inTable('accounts');
    t.index(['account_id']);
  });

  await knex('price_books').insert({
    key: 'standard',
    name: 'Standard',
    values: JSON.stringify(STANDARD_VALUES),
    is_default: true,
  });
  await knex('platform_settings').insert(
    Object.entries(SETTINGS).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
  );

  await backfillAccounts(knex);
  await knex.raw('ALTER TABLE tenants ALTER COLUMN account_id SET NOT NULL');
}

/**
 * One account per institute owner (an owner of several institutes gets one account for all of
 * them). tenant_memberships has forced RLS and the production migration role may not bypass
 * it, so each tenant's owner is read with that tenant as the context, like the app does. The
 * explicit tenant_id filter keeps the result identical for a role that does bypass RLS.
 */
async function backfillAccounts(knex: Knex) {
  const tenants: { id: string; name: string; plan_expires_at: Date | null }[] = await knex(
    'tenants',
  )
    .orderBy('created_at')
    .select('id', 'name', 'plan_expires_at');
  const freeUntil = new Date(Date.now() + EXISTING_FREE_DAYS * 86400_000);
  const groups = new Map<
    string,
    { userId: string | null; phone: string; name: string; trialEndsAt: Date; tenantIds: string[] }
  >();

  for (const t of tenants) {
    await knex.raw("SELECT set_config('app.tenant_id', ?, true)", [t.id]);
    const members = knex('tenant_memberships as m')
      .join('users as u', 'u.id', 'm.user_id')
      .where({ 'm.tenant_id': t.id, 'm.status': 'active' })
      .orderBy('m.created_at');
    const owner = await members
      .clone()
      .whereExists((q) =>
        q.from('membership_roles as r').whereRaw('r.membership_id = m.id').where('r.role', 'owner'),
      )
      .first('u.id', 'u.phone');
    // No active owner (not expected): the institute gets its own unclaimed account, held by
    // the phone of its first member so the platform admin can see who to contact.
    const fallback = owner ? undefined : await members.clone().first('u.phone');
    const key = owner ? owner.id : `tenant:${t.id}`;
    if (!owner) console.warn(`013: tenant ${t.id} has no active owner; unclaimed account created`);

    const paid = t.plan_expires_at && t.plan_expires_at > freeUntil ? t.plan_expires_at : freeUntil;
    const group = groups.get(key);
    if (group) {
      group.tenantIds.push(t.id);
      if (paid > group.trialEndsAt) group.trialEndsAt = paid;
    } else {
      groups.set(key, {
        userId: owner?.id ?? null,
        phone: owner?.phone ?? fallback?.phone ?? '000000000',
        name: t.name,
        trialEndsAt: paid,
        tenantIds: [t.id],
      });
    }
  }
  await knex.raw("SELECT set_config('app.tenant_id', '', true)");

  for (const g of groups.values()) {
    const [account] = await knex('accounts')
      .insert({
        name: g.name,
        owner_user_id: g.userId,
        owner_phone: g.phone,
        price_book: 'standard',
        trial_ends_at: g.trialEndsAt,
      })
      .returning('id');
    await knex('tenants').whereIn('id', g.tenantIds).update({ account_id: account.id });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('account_id');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('is_platform_admin');
  });
  await knex.schema.dropTable('platform_audit');
  await knex.schema.dropTable('subscription_payments');
  await knex.schema.dropTable('subscription_invoices');
  await knex.schema.dropTable('account_overrides');
  await knex.schema.dropTable('accounts');
  await knex.schema.dropTable('platform_settings');
  await knex.schema.dropTable('price_books');
}
