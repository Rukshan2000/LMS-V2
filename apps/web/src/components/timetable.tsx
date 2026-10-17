'use client';

import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { addDays, colomboDate, fmtDay, fmtTime, mondayOf } from '@/lib/datetime';
import { SessionActions } from './classes/session-actions';
import type { Session } from './classes/types';
import { btn, card, EmptyState, FormError, Skeleton } from './ui';

export function Timetable() {
  const { lang, t } = useI18n();
  const tt = t.timetable;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [monday, setMonday] = useState(() => mondayOf(colomboDate()));
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ sessions: Session[] }>(
      `/tenants/${tenantId}/sessions?from=${monday}&to=${addDays(monday, 6)}`,
    )
      .then((r) => !cancelled && setSessions(r.sessions))
      .catch((err) => !cancelled && setError(errorMessage(t, err)));
    return () => {
      cancelled = true;
    };
  }, [tenantId, monday, t]);

  const byDay = new Map<string, Session[]>();
  for (const s of sessions ?? []) {
    const day = colomboDate(s.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{tt.title}</h1>
        <button
          type="button"
          onClick={() => setMonday(addDays(monday, -7))}
          className={btn('secondary')}
        >
          <ChevronLeft aria-hidden className="size-4" />
          {tt.prevWeek}
        </button>
        <button
          type="button"
          onClick={() => setMonday(mondayOf(colomboDate()))}
          className={btn('secondary')}
        >
          <CalendarCheck aria-hidden className="size-4" />
          {tt.thisWeek}
        </button>
        <button
          type="button"
          onClick={() => setMonday(addDays(monday, 7))}
          className={btn('secondary')}
        >
          {tt.nextWeek}
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
      <FormError message={error} />
      {sessions === null ? (
        <Skeleton />
      ) : sessions.length === 0 ? (
        <EmptyState icon={CalendarX}>{tt.noClasses}</EmptyState>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className={`${card} animate-fade-in overflow-hidden`}>
            <h2 className="border-b border-line bg-surface-soft px-4 py-2 font-medium">
              {fmtDay(list[0]!.startsAt, t.calendar)}
            </h2>
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="w-24 font-mono">
                    {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${s.status === 'cancelled' ? 'text-ink-subtle line-through' : ''}`}
                  >
                    <Link
                      href={`/${lang}/t/${tenantId}/classes/${s.batchId}`}
                      className="font-medium hover:underline"
                    >
                      {s.batchName}
                    </Link>
                    <span className="text-ink-subtle">
                      {' '}
                      ·{' '}
                      {[s.subjectName, s.teacherName, s.room, s.isExtra ? tt.extra : null, s.note]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <SessionActions
                    session={s}
                    onChange={(next) =>
                      setSessions((all) => all && all.map((x) => (x.id === next.id ? next : x)))
                    }
                    onError={(err) => setError(errorMessage(t, err))}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
