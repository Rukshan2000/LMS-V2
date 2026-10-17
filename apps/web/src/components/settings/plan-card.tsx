'use client';

import { CircleAlert, CreditCard } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/lib/api';
import { fmtMoney } from '@/lib/money';
import { useTenantData } from '../dashboard-shell';
import { Badge, card, type Tone } from '../ui';

const STATE_TONE: Record<string, Tone> = {
  trial: 'primary',
  active: 'success',
  overdue: 'warning',
  restricted: 'danger',
  suspended: 'danger',
};

/** Settings: account state (trial, payment due) and student usage. Billing details come in Phase 4. */
export function PlanCard() {
  const { t } = useI18n();
  const p = t.plans;
  const { entitlements: e } = useTenantData();
  const { limit, used = 0 } = e.caps.students;
  const full = limit !== null && used >= limit;
  const status =
    e.state === 'trial'
      ? fmt(p.trial, { days: e.daysLeft ?? 0 })
      : e.state === 'active'
        ? p.active
        : e.state === 'suspended'
          ? p.suspended
          : fmt(p[e.state], { amount: fmtMoney(e.amountDue) });

  return (
    <section className={`${card} space-y-3 p-4 text-sm`}>
      <h2 className="flex flex-wrap items-center gap-2 text-base font-medium">
        <CreditCard aria-hidden className="size-5 text-primary" />
        {p.title}
        <Badge tone={STATE_TONE[e.state]}>{status}</Badge>
      </h2>
      <p>
        {limit === null
          ? fmt(p.studentsUnlimited, { active: used })
          : fmt(p.students, { active: used, limit })}
      </p>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-soft">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${full ? 'bg-danger-solid' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, (used * 100) / limit)}%` }}
          />
        </div>
      )}
      {full && (
        <p className="flex items-center gap-1.5 font-medium text-danger">
          <CircleAlert aria-hidden className="size-4" />
          {p.full}
        </p>
      )}
      <p className="text-ink-subtle">{p.billing}</p>
    </section>
  );
}
