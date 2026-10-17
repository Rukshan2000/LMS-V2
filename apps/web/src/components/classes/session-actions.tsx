'use client';

import { ArrowRightLeft, Ban, Check, RotateCcw, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { colomboDate, colomboTime, toIso } from '@/lib/datetime';
import { Badge, btn } from '../ui';
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

  const input = 'rounded-lg border border-line-strong px-1.5 py-1';
  return (
    <span className="flex flex-wrap items-center gap-2">
      {session.status === 'cancelled' ? (
        <>
          <Badge status="cancelled">{tt.cancelled}</Badge>
          <button
            type="button"
            onClick={() => patch({ status: 'scheduled' })}
            className={btn('link', 'none')}
          >
            <RotateCcw aria-hidden className="size-4" />
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
            className={btn('link', 'none')}
          >
            <Check aria-hidden className="size-4" />
            {tt.save}
          </button>
          <button
            type="button"
            onClick={() => setMoving(false)}
            className={btn('linkMuted', 'none')}
          >
            <X aria-hidden className="size-4" />
            {tt.close}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setMoving(true)} className={btn('link', 'none')}>
            <ArrowRightLeft aria-hidden className="size-4" />
            {tt.move}
          </button>
          <button
            type="button"
            onClick={() => patch({ status: 'cancelled' })}
            className={btn('linkDanger', 'none')}
          >
            <Ban aria-hidden className="size-4" />
            {tt.cancel}
          </button>
        </>
      )}
    </span>
  );
}
