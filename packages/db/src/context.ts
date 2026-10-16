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
