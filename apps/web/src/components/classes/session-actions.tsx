'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { colomboDate, colomboTime, toIso } from '@/lib/datetime';
import type { Session } from './types';

/** Cancel / restore / move one class. Teachers (own classes), admins and owners. */
export function SessionActions({
  session,
  onChange,
  onError,
}: {
  session: Session;
  onChange: (s: Session) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const tt = t.timetable;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState({
    date: colomboDate(session.startsAt),
    start: colomboTime(session.startsAt),
    end: colomboTime(session.endsAt),
  });

  async function patch(body: object) {
    try {
      const res = await api<{ session: Session }>(`/tenants/${tenantId}/sessions/${session.id}`, {
        method: 'PATCH',
        body,
      });
      onChange(res.session);
      setMoving(false);
    } catch (err) {
      onError(err);
    }
  }

  const input = 'rounded border border-zinc-300 px-1.5 py-1';
  return (
    <span className="flex flex-wrap items-center gap-2">
      {session.status === 'cancelled' ? (
        <>
          <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">{tt.cancelled}</span>
          <button
            type="button"
            onClick={() => patch({ status: 'scheduled' })}
            className="text-indigo-600"
          >
            {tt.restore}
          </button>
        </>
      ) : moving ? (
        <>
          <input
            type="date"
            aria-label={tt.date}
            value={to.date}
            onChange={(e) => setTo({ ...to, date: e.target.value })}
            className={input}
          />
          <input
            type="time"
            aria-label={t.classes.start}
            value={to.start}
            onChange={(e) => setTo({ ...to, start: e.target.value })}
            className={input}
          />
          <input
            type="time"
            aria-label={t.classes.end}
            value={to.end}
            onChange={(e) => setTo({ ...to, end: e.target.value })}
            className={input}
          />
          <button
            type="button"
            onClick={() =>
              patch({ startsAt: toIso(to.date, to.start), endsAt: toIso(to.date, to.end) })
            }
            className="font-medium text-indigo-600"
          >
            {tt.save}
          </button>
          <button type="button" onClick={() => setMoving(false)} className="text-zinc-500">
            {tt.close}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setMoving(true)} className="text-indigo-600">
            {tt.move}
          </button>
          <button
            type="button"
            onClick={() => patch({ status: 'cancelled' })}
            className="text-red-600"
          >
            {tt.cancel}
          </button>
        </>
      )}
    </span>
  );
}
