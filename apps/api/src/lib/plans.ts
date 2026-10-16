import type { Knex } from 'knex';
import { HttpError } from './http-error.js';

// Active-student limit per plan (ADR 008). null = no limit.
// ponytail: Teacher cap is a guess until pilot pricing is confirmed; change the number here.
export const STUDENT_LIMITS = { free: 50, teacher: 400, institute: null } as const;
export type Plan = keyof typeof STUDENT_LIMITS;

/** Plan in force now: an expired paid plan counts as Free. Includes active-student usage. */
export async function planUsage(trx: Knex.Transaction, tenantId: string) {
  const t = await trx('tenants')
    .where({ id: tenantId })
    .first(
      'plan',
      'plan_expires_at as planExpiresAt',
      trx.raw(`(plan = 'free' OR plan_expires_at > now()) AS current`),
    );
  const effectivePlan: Plan = t.current ? t.plan : 'free';
  const row = await trx('students').where({ status: 'active' }).count({ count: '*' }).first();
  return {
    plan: t.plan as Plan,
    planExpiresAt: t.planExpiresAt as Date | null,
    effectivePlan,
    studentLimit: STUDENT_LIMITS[effectivePlan] as number | null,
    activeStudents: Number(row?.count ?? 0),
  };
}

/**
 * Refuse to add `adding` active students beyond the plan limit. Takes a per-tenant lock so two
 * desks adding the 50th student at the same moment cannot both succeed.
 */
export async function assertStudentCapacity(trx: Knex.Transaction, tenantId: string, adding = 1) {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`students:${tenantId}`]);
  const usage = await planUsage(trx, tenantId);
  if (usage.studentLimit !== null && usage.activeStudents + adding > usage.studentLimit) {
    throw new HttpError(403, 'plan_limit', 'Your plan’s student limit is reached', {
      limit: usage.studentLimit,
      active: usage.activeStudents,
    });
  }
}
