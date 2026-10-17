import type { Knex } from 'knex';

// Request context is set per transaction (set_config(..., true) = SET LOCAL), so it
// can never leak to the next query that reuses the pooled connection.
/** Set request context inside an existing transaction (e.g. right after creating a tenant). */
export async function setContext(
  trx: Knex.Transaction,
  ctx: { tenantId?: string; userId?: string },
): Promise<void> {
  await trx.raw("SELECT set_config('app.tenant_id', ?, true), set_config('app.user_id', ?, true)", [
    ctx.tenantId ?? '',
    ctx.userId ?? '',
  ]);
}

/**
 * Run `work` once per tenant inside an existing transaction, each time with that tenant as the
 * RLS context, then put the caller's context back. For server-side counts across the institutes
 * of one customer account. `tenantIds` MUST come from the server (tenants.account_id), never
 * from the request.
 */
export async function forEachTenant<T>(
  trx: Knex.Transaction,
  tenantIds: string[],
  work: (tenantId: string) => Promise<T>,
): Promise<T[]> {
  const {
    rows: [prev],
  } = await trx.raw(
    "SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('app.user_id', true) AS user",
  );
  const restore = () =>
    setContext(trx, { tenantId: prev.tenant || undefined, userId: prev.user || undefined });
  const results: T[] = [];
  try {
    for (const tenantId of tenantIds) {
      await setContext(trx, { tenantId, userId: prev.user || undefined });
      results.push(await work(tenantId));
    }
  } catch (err) {
    // After a failed statement the transaction is aborted and cannot be restored; it will roll back.
    await restore().catch(() => {});
    throw err;
  }
  await restore();
  return results;
}

async function withContext<T>(
  knex: Knex,
  ctx: { tenantId?: string; userId?: string },
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => {
    await setContext(trx, ctx);
    return work(trx);
  });
}

/**
 * Run tenant-scoped queries. `tenantId` MUST come from a verified membership,
 * never from an unchecked header or body. Use only `trx` inside `work`.
 */
export function withTenant<T>(
  knex: Knex,
  ctx: { tenantId: string; userId?: string },
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return withContext(knex, ctx, work);
}

/** Queries before a tenant is chosen (e.g. "which institutes do I belong to?"). */
export function withUser<T>(
  knex: Knex,
  userId: string,
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return withContext(knex, { userId }, work);
}
