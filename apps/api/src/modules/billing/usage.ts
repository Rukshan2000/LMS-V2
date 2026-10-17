import { forEachTenant } from '@lms/db';
import type { Knex } from 'knex';
import { HEADS, type Head } from './catalogue.js';

export type HeadCounts = Record<Head, number>;

const zero = (): HeadCounts => Object.fromEntries(HEADS.map((h) => [h, 0])) as HeadCounts;

/**
 * Live head counts in one institute. Must run with that tenant as the RLS context; the explicit
 * tenant filter keeps it correct for roles that bypass RLS too.
 */
export async function countHeads(trx: Knex.Transaction, tenantId: string): Promise<HeadCounts> {
  const counts = zero();
  const students = await trx('students')
    .where({ tenant_id: tenantId, status: 'active' })
    .count({ n: '*' })
    .first();
  counts.student = Number(students?.n ?? 0);
  const roles: { role: Head; n: string }[] = await trx('membership_roles as r')
    .join('tenant_memberships as m', 'm.id', 'r.membership_id')
    .where({ 'm.tenant_id': tenantId, 'm.status': 'active' })
    .whereIn('r.role', ['teacher', 'parent', 'admin', 'receptionist'])
    .groupBy('r.role')
    .select('r.role', trx.raw('count(DISTINCT m.id) AS n'));
  for (const { role, n } of roles) counts[role] = Number(n);
  return counts;
}

export const accountTenantIds = (trx: Knex.Transaction, accountId: string): Promise<string[]> =>
  trx('tenants').where({ account_id: accountId }).orderBy('created_at').pluck('id');

/** Head counts summed over every institute of the account (each counted in its own context). */
export async function countAccountHeads(
  trx: Knex.Transaction,
  accountId: string,
): Promise<HeadCounts & { institutes: number }> {
  const ids = await accountTenantIds(trx, accountId);
  const total = zero();
  for (const counts of await forEachTenant(trx, ids, (id) => countHeads(trx, id))) {
    for (const head of HEADS) total[head] += counts[head];
  }
  return { ...total, institutes: ids.length };
}
