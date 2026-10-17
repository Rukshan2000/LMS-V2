'use client';

import { BookOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { weekdayName } from '@/lib/datetime';
import { useTenantData } from '../dashboard-shell';
import { Badge, btn, card, EmptyState, FormError, Skeleton } from '../ui';
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
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {c.showArchived}
        </label>
        {canCreate && (
          <Link href={`${base}/new`} className={btn('primary', 'md')}>
            <Plus aria-hidden className="size-4" />
            {c.add}
          </Link>
        )}
      </div>
      <FormError message={error} />
      {batches === null ? (
        <Skeleton />
      ) : batches.length === 0 ? (
        <EmptyState icon={BookOpen}>{c.empty}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {batches.map((b) => (
            <li key={b.id}>
              <Link
                href={`${base}/${b.id}`}
                className={`${card} block h-full p-4 transition duration-200 hover:-translate-y-px hover:border-primary-ring hover:shadow-raised`}
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.name}</span>
                    <span className="block text-sm text-ink-subtle">{b.subjectName}</span>
                  </span>
                  {b.status === 'archived' && <Badge tone="neutral">{c.archived}</Badge>}
                </div>
                <ul className="mt-3 space-y-0.5 text-sm text-ink-muted">
                  {b.schedule.map((s, i) => (
                    <li key={i}>
                      {weekdayName(s.weekday, t.calendar)} {s.startTime}–{s.endTime}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink-subtle">
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
