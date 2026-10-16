'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { addDays, colomboDate, fmtDay, fmtTime, mondayOf } from '@/lib/datetime';
import { SessionActions } from './classes/session-actions';
import type { Session } from './classes/types';
import { FormError } from './ui';

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
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          {tt.prevWeek}
        </button>
        <button
          type="button"
          onClick={() => setMonday(mondayOf(colomboDate()))}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          {tt.thisWeek}
        </button>
        <button
          type="button"
          onClick={() => setMonday(addDays(monday, 7))}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          {tt.nextWeek}
        </button>
      </div>
      <FormError message={error} />
      {sessions === null ? (
        <p className="text-zinc-500">{t.loading}</p>
      ) : sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
          {tt.noClasses}
        </p>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className="rounded-xl border border-zinc-200 bg-white">
            <h2 className="border-b border-zinc-100 px-4 py-2 font-medium">
              {fmtDay(list[0]!.startsAt, t.calendar)}
            </h2>
            <ul className="divide-y divide-zinc-100">
              {list.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="w-24 font-mono">
                    {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${s.status === 'cancelled' ? 'text-zinc-400 line-through' : ''}`}
                  >
                    <Link
                      href={`/${lang}/t/${tenantId}/classes/${s.batchId}`}
                      className="font-medium hover:underline"
                    >
                      {s.batchName}
                    </Link>
                    <span className="text-zinc-500">
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
