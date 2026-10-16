'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, fmt } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';

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
    <section className="max-w-xl space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <h2 className="font-medium">
        {p.title}: {p.names[usage.effectivePlan]}
      </h2>
      <p>
        {limit === null ? fmt(p.studentsUnlimited, { active }) : fmt(p.students, { active, limit })}
      </p>
      {limit !== null && (
        <div className="h-2 overflow-hidden rounded bg-zinc-100">
          <div
            className={`h-full ${full ? 'bg-red-600' : 'bg-indigo-600'}`}
            style={{ width: `${Math.min(100, (active * 100) / limit)}%` }}
          />
        </div>
      )}
      {usage.planExpiresAt && (
        <p className={expired ? 'font-medium text-red-700' : 'text-zinc-600'}>
          {fmt(expired ? p.expired : p.paidUntil, {
            plan: p.names[usage.plan],
            date: colomboDate(usage.planExpiresAt),
          })}
        </p>
      )}
      {full && <p className="font-medium text-red-700">{p.full}</p>}
      <p className="text-zinc-500">{p.upgrade}</p>
    </section>
  );
}
