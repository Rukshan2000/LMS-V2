'use client';

import { CalendarX, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { colomboDate, fmtTime } from '@/lib/datetime';
import type { Session } from '../classes/types';
import { EmptyState, FormError, Skeleton } from '../ui';

/** Classes on one day, each linking to its register. */
export function AttendanceDay() {
  const { lang, t } = useI18n();
  const a = t.attendance;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [date, setDate] = useState(colomboDate);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ sessions: Session[] }>(`/tenants/${tenantId}/sessions?from=${date}&to=${date}`)
      .then((r) => setSessions(r.sessions))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, date, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{a.title}</h1>
        <label className="text-sm text-ink-muted">
          {a.date}{' '}
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="ml-1 rounded-lg border border-line-strong px-2 py-1"
          />
        </label>
      </div>
      <FormError message={error} />
      {sessions === null ? (
        <Skeleton />
      ) : sessions.length === 0 ? (
        <EmptyState icon={CalendarX}>{a.noClasses}</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/${lang}/t/${tenantId}/attendance/${s.id}`}
                className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-soft ${s.status === 'cancelled' ? 'text-ink-subtle line-through' : ''}`}
              >
                <span className="w-24 font-mono text-sm">
                  {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
                </span>
                <span className="flex-1 font-medium">{s.batchName}</span>
                <span className="text-sm text-ink-subtle">{s.subjectName}</span>
                <ChevronRight aria-hidden className="size-4 text-ink-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
