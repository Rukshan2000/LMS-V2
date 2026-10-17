'use client';

import { CircleAlert, CreditCard } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, fmt } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { card } from '../ui';

export interface Usage {
  plan: 'free' | 'teacher' | 'institute';
  planExpiresAt: string | null;
  effectivePlan: 'free' | 'teacher' | 'institute';
  studentLimit: number | null;
  activeStudents: number;
}

/** Settings: current plan, student usage, expiry and how to upgrade (bank transfer, manual). */
export function PlanCard() {
  const { t } = useI18n();
  const p = t.plans;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    api<{ usage: Usage }>(`/tenants/${tenantId}`)
      .then((r) => setUsage(r.usage))
      .catch(() => setUsage(null));
  }, [tenantId]);

  if (!usage) return null;
  const { studentLimit: limit, activeStudents: active } = usage;
  const full = limit !== null && active >= limit;
  const expired = usage.plan !== usage.effectivePlan;
  return (
    <section className={`${card} space-y-3 p-4 text-sm`}>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <CreditCard aria-hidden className="size-5 text-primary" />
        {p.title}: {p.names[usage.effectivePlan]}
      </h2>
      <p>
        {limit === null ? fmt(p.studentsUnlimited, { active }) : fmt(p.students, { active, limit })}
      </p>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-soft">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${full ? 'bg-danger-solid' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, (active * 100) / limit)}%` }}
          />
        </div>
      )}
      {usage.planExpiresAt && (
        <p className={expired ? 'font-medium text-danger' : 'text-ink-muted'}>
          {fmt(expired ? p.expired : p.paidUntil, {
            plan: p.names[usage.plan],
            date: colomboDate(usage.planExpiresAt),
          })}
        </p>
      )}
      {full && (
        <p className="flex items-center gap-1.5 font-medium text-danger">
          <CircleAlert aria-hidden className="size-4" />
          {p.full}
        </p>
      )}
      <p className="text-ink-subtle">{p.upgrade}</p>
    </section>
  );
}
