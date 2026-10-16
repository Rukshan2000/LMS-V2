import type { Knex } from 'knex';
import { TIME_ZONE } from '../../lib/time.js';

/**
 * Create class_sessions for every active weekly rule occurring between `from` and `to`
 * (inclusive dates). Idempotent: a slot that already exists — even if it was moved or
 * cancelled — is never recreated. RLS limits it to the current tenant.
 */
export async function ensureSessions(
  trx: Knex.Transaction,
  from: string,
  to: string,
  batchId?: string,
) {
  await trx.raw(
    `INSERT INTO class_sessions (tenant_id, batch_id, schedule_rule_id, occurrence_date, starts_at, ends_at)
     SELECT r.tenant_id, r.batch_id, r.id, d::date,
            (d::date + r.start_time) AT TIME ZONE '${TIME_ZONE}',
            (d::date + r.end_time) AT TIME ZONE '${TIME_ZONE}'
     FROM schedule_rules r
     JOIN batches b ON b.id = r.batch_id AND b.status = 'active'
     CROSS JOIN LATERAL generate_series(
       GREATEST(?::date, r.valid_from),
       LEAST(?::date, COALESCE(r.valid_to, ?::date)),
       interval '1 day') AS d
     WHERE EXTRACT(ISODOW FROM d) = r.weekday ${batchId ? 'AND r.batch_id = ?' : ''}
     ON CONFLICT (schedule_rule_id, occurrence_date) DO NOTHING`,
    batchId ? [from, to, to, batchId] : [from, to, to],
  );
}
