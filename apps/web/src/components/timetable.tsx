'use client';

import type { DatesSetArg, DayHeaderContentArg, EventClickArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { addDays, colomboDate, colomboTime, fmtDay } from '@/lib/datetime';
import { SessionActions } from './classes/session-actions';
import type { Session } from './classes/types';
import { Badge, btn, card, FormError } from './ui';
import './timetable.css';

const VIEWS = { week: 'timeGridWeek', month: 'dayGridMonth', list: 'listWeek' } as const;
type ViewKey = keyof typeof VIEWS;

/**
 * The calendar runs in UTC and is fed Sri Lanka wall-clock times ("2026-10-17T14:00"), so it
 * shows Colombo time on any device without a time zone plugin.
 */
const wall = (iso: string) => `${colomboDate(iso)}T${colomboTime(iso)}`;

export function Timetable() {
  const { lang, t } = useI18n();
  const tt = t.timetable;
  const { tenantId } = useParams<{ tenantId: string }>();
  const calendar = useRef<FullCalendar>(null);
  const [range, setRange] = useState<{ from: string; to: string; view: ViewKey } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phones get the list view: a 7-column time grid is unreadable at 360px.
  useEffect(() => {
    if (matchMedia('(max-width: 639px)').matches) calendar.current?.getApi().changeView(VIEWS.list);
  }, []);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;
    api<{ sessions: Session[] }>(`/tenants/${tenantId}/sessions?from=${range.from}&to=${range.to}`)
      .then((r) => !cancelled && setSessions(r.sessions))
      .catch((err) => !cancelled && setError(errorMessage(t, err)));
    return () => {
      cancelled = true;
    };
  }, [tenantId, range, t]);

  const cal = () => calendar.current?.getApi();
  const session = sessions.find((s) => s.id === selected);
  // 06:00–22:00 by default, stretched so an early or late class is never off the grid.
  const hours = sessions.flatMap((s) => [colomboTime(s.startsAt), colomboTime(s.endsAt)]).sort();
  const first = hours[0]?.slice(0, 2) ?? '06';
  const slotMin = `${first < '06' ? first : '06'}:00`;
  const slotMax = (hours.at(-1) ?? '') > '22:00' ? '24:00' : '22:00';
  const month = (date: string) => t.calendar.months[Number(date.slice(5, 7)) - 1];
  const title = !range
    ? ''
    : range.view === 'month'
      ? // Month view starts in the previous month's last week; the middle day is in the month.
        `${month(addDays(range.from, 15))} ${addDays(range.from, 15).slice(0, 4)}`
      : `${Number(range.from.slice(8))} ${month(range.from)} – ${Number(range.to.slice(8))} ${month(range.to)}`;

  function onDates(arg: DatesSetArg) {
    const view = (Object.keys(VIEWS) as ViewKey[]).find((k) => VIEWS[k] === arg.view.type)!;
    // end is exclusive; with timeZone UTC the ISO date part is the Colombo date.
    setRange({
      from: arg.startStr.slice(0, 10),
      to: addDays(arg.endStr.slice(0, 10), -1),
      view,
    });
  }

  function dayHeader(arg: DayHeaderContentArg) {
    const weekday = t.calendar.weekdays[(arg.date.getUTCDay() + 6) % 7];
    if (arg.view.type === VIEWS.month) return weekday;
    const date = arg.date.toISOString().slice(0, 10);
    return (
      <span className="inline-flex flex-col items-center leading-tight font-medium">
        {weekday}
        <span className="text-xs font-normal text-ink-subtle">
          {Number(date.slice(8))} {month(date)}
        </span>
      </span>
    );
  }

  const tab = (on: boolean) =>
    `px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'bg-primary-soft text-primary-hover' : 'text-ink-muted hover:bg-surface-soft hover:text-ink'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{tt.title}</h1>
          <p className="text-sm text-ink-subtle">{title}</p>
        </div>
        <div className={`${card} inline-flex divide-x divide-line overflow-hidden`}>
          <button
            type="button"
            aria-label={tt.prevWeek}
            onClick={() => cal()?.prev()}
            className={tab(false)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button type="button" onClick={() => cal()?.today()} className={tab(false)}>
            {tt.today}
          </button>
          <button
            type="button"
            aria-label={tt.nextWeek}
            onClick={() => cal()?.next()}
            className={tab(false)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
        <div role="group" className={`${card} inline-flex divide-x divide-line overflow-hidden`}>
          {(Object.keys(VIEWS) as ViewKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={range?.view === k}
              onClick={() => cal()?.changeView(VIEWS[k])}
              className={tab(range?.view === k)}
            >
              {tt[k]}
            </button>
          ))}
        </div>
      </div>
      <FormError message={error} />

      <div className={`${card} timetable overflow-hidden p-2 sm:p-3`}>
        <FullCalendar
          ref={calendar}
          plugins={[timeGridPlugin, dayGridPlugin, listPlugin]}
          initialView={VIEWS.week}
          headerToolbar={false}
          timeZone="UTC"
          now={() => wall(new Date().toISOString())}
          firstDay={1}
          height="auto"
          allDaySlot={false}
          nowIndicator
          slotMinTime={slotMin}
          slotMaxTime={slotMax}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayHeaderContent={dayHeader}
          noEventsContent={tt.noClasses}
          datesSet={onDates}
          eventClick={(arg: EventClickArg) => setSelected(arg.event.id)}
          events={sessions.map((s) => ({
            id: s.id,
            title: s.batchName,
            start: wall(s.startsAt),
            end: wall(s.endsAt),
            classNames: [
              s.status === 'cancelled' ? 'is-cancelled' : s.isExtra ? 'is-extra' : '',
              s.id === selected ? 'is-selected' : '',
            ],
          }))}
        />
      </div>

      {session && (
        <section
          key={session.id}
          className={`${card} animate-fade-in flex flex-wrap items-start gap-x-4 gap-y-2 p-4 text-sm`}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <Link
                href={`/${lang}/t/${tenantId}/classes/${session.batchId}`}
                className="text-base font-medium hover:underline"
              >
                {session.batchName}
              </Link>
              {session.status === 'cancelled' && <Badge status="cancelled">{tt.cancelled}</Badge>}
              {session.isExtra && <Badge tone="primary">{tt.extra}</Badge>}
            </p>
            <p className="text-ink-muted">
              {fmtDay(session.startsAt, t.calendar)} · {colomboTime(session.startsAt)}–
              {colomboTime(session.endsAt)}
            </p>
            <p className="text-ink-subtle">
              {[session.subjectName, session.teacherName, session.room, session.note]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <SessionActions
            session={session}
            onChange={(next) => setSessions((all) => all.map((x) => (x.id === next.id ? next : x)))}
            onError={(err) => setError(errorMessage(t, err))}
          />
          <button
            type="button"
            aria-label={tt.close}
            onClick={() => setSelected(null)}
            className={btn('linkMuted', 'none')}
          >
            <X aria-hidden className="size-4" />
          </button>
        </section>
      )}
    </div>
  );
}
