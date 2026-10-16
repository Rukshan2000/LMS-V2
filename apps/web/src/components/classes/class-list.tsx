'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { weekdayName } from '@/lib/datetime';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';
import type { BatchSummary } from './types';

export function ClassList() {
  const { lang, t } = useI18n();
  const c = t.classes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { roles } = useTenantData();
  const canCreate = roles.includes('owner') || roles.includes('admin');
  const base = `/${lang}/t/${tenantId}/classes`;
  const [showArchived, setShowArchived] = useState(false);
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ batches: BatchSummary[] }>(
      `/tenants/${tenantId}/batches?status=${showArchived ? 'all' : 'active'}`,
    )
      .then((res) => setBatches(res.batches))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, showArchived, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{c.title}</h1>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {c.showArchived}
        </label>
        {canCreate && (
          <Link
            href={`${base}/new`}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          >
            {c.add}
          </Link>
        )}
      </div>
      <FormError message={error} />
      {batches === null ? (
        <p className="text-zinc-500">{t.loading}</p>
      ) : batches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
          {c.empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {batches.map((b) => (
            <li key={b.id}>
              <Link
                href={`${base}/${b.id}`}
                className="block h-full rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.name}</span>
                    <span className="block text-sm text-zinc-500">{b.subjectName}</span>
                  </span>
                  {b.status === 'archived' && (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      {c.archived}
                    </span>
                  )}
                </div>
                <ul className="mt-3 space-y-0.5 text-sm text-zinc-700">
                  {b.schedule.map((s, i) => (
                    <li key={i}>
                      {weekdayName(s.weekday, t.calendar)} {s.startTime}–{s.endTime}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-zinc-500">
                  {[b.teacherName, fmt(c.studentCount, { count: b.studentCount }), c[b.mode]]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
