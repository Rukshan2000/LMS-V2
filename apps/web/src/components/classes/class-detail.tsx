'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { addDays, colomboDate, fmtDay, fmtTime, weekdayName } from '@/lib/datetime';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';
import type { StudentRow } from '../students/types';
import type { BatchDetail, Session } from './types';
import { ClassFees } from '../fees/class-fees';
import { SessionActions } from './session-actions';

const input = 'rounded-lg border border-zinc-300 bg-white px-2 py-1.5';

export function ClassDetail() {
  const { lang, t } = useI18n();
  const c = t.classes;
  const { tenantId, batchId } = useParams<{ tenantId: string; batchId: string }>();
  const { roles } = useTenantData();
  const manager = roles.includes('owner') || roles.includes('admin');
  const desk = manager || roles.includes('receptionist');
  const url = `/tenants/${tenantId}/batches/${batchId}`;

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState({
    weekday: '6',
    startTime: '14:00',
    endTime: '17:00',
    validFrom: colomboDate(),
    room: '',
  });
  const [q, setQ] = useState('');
  const [found, setFound] = useState<StudentRow[]>([]);

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const loadSessions = useCallback(() => {
    const from = colomboDate();
    api<{ sessions: Session[] }>(
      `/tenants/${tenantId}/sessions?from=${from}&to=${addDays(from, 27)}&batchId=${batchId}`,
    )
      .then((r) => setSessions(r.sessions))
      .catch(fail);
  }, [tenantId, batchId, fail]);

  useEffect(() => {
    api<{ batch: BatchDetail }>(url)
      .then((r) => setBatch(r.batch))
      .catch(fail);
    loadSessions();
  }, [url, fail, loadSessions]);

  const searching = desk && q.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => {
      api<{ students: StudentRow[] }>(
        `/tenants/${tenantId}/students?q=${encodeURIComponent(q.trim())}&limit=10`,
      )
        .then((r) => setFound(r.students))
        .catch(fail);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, searching, tenantId, fail]);

  async function run(promise: Promise<{ batch: BatchDetail }>) {
    setError(null);
    try {
      setBatch((await promise).batch);
      loadSessions();
    } catch (err) {
      fail(err);
    }
  }

  function addSlot(e: FormEvent) {
    e.preventDefault();
    void run(
      api(`${url}/schedule`, {
        method: 'POST',
        body: { ...slot, weekday: Number(slot.weekday), room: slot.room || undefined },
      }),
    );
  }

  if (!batch)
    return error ? <FormError message={error} /> : <p className="text-zinc-500">{t.loading}</p>;
  const enrolled = new Set(batch.students.map((s) => s.id));

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/${lang}/t/${tenantId}/classes`} className="text-sm text-indigo-600">
        {c.back}
      </Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{batch.name}</h1>
          <p className="text-zinc-600">
            {[batch.subjectName, batch.teacherName ?? c.noTeacher, c[batch.mode]].join(' · ')}
          </p>
        </div>
        {manager && (
          <button
            type="button"
            onClick={() =>
              run(
                api(url, {
                  method: 'PATCH',
                  body: { status: batch.status === 'active' ? 'archived' : 'active' },
                }),
              )
            }
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm"
          >
            {batch.status === 'active' ? c.archive : c.restore}
          </button>
        )}
      </div>
      <FormError message={error} />

      {manager && <ClassFees batchId={batch.id} />}

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">{c.schedule}</h2>
        {batch.schedule.length === 0 && <p className="text-sm text-zinc-500">{c.noSchedule}</p>}
        <ul className="divide-y divide-zinc-100">
          {batch.schedule.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">
                {weekdayName(s.weekday, t.calendar)} {s.startTime}–{s.endTime}
                {s.room && <span className="text-zinc-500"> · {s.room}</span>}
              </span>
              {manager && (
                <button
                  type="button"
                  onClick={() => run(api(`${url}/schedule/${s.id}`, { method: 'DELETE' }))}
                  className="text-sm text-red-600"
                >
                  {c.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
        {manager && (
          <form
            onSubmit={addSlot}
            className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3 text-sm"
          >
            <label className="flex flex-col gap-1">
              {c.day}
              <select
                value={slot.weekday}
                onChange={(e) => setSlot({ ...slot, weekday: e.target.value })}
                className={input}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {weekdayName(d, t.calendar)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {c.start}
              <input
                type="time"
                required
                value={slot.startTime}
                onChange={(e) => setSlot({ ...slot, startTime: e.target.value })}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              {c.end}
              <input
                type="time"
                required
                value={slot.endTime}
                onChange={(e) => setSlot({ ...slot, endTime: e.target.value })}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              {c.startsOn}
              <input
                type="date"
                required
                value={slot.validFrom}
                onChange={(e) => setSlot({ ...slot, validFrom: e.target.value })}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              {c.room}
              <input
                value={slot.room}
                maxLength={100}
                onChange={(e) => setSlot({ ...slot, room: e.target.value })}
                className={input}
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white"
            >
              {c.addTime}
            </button>
          </form>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">
          {c.enrolled} ({batch.students.length})
        </h2>
        {desk && (
          <div className="relative">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={c.searchStudents}
              aria-label={c.searchStudents}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
            {searching && found.length > 0 && (
              <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {found.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-12 font-mono text-zinc-500">{s.studentNumber}</span>
                    <span className="flex-1">{s.fullName}</span>
                    {!enrolled.has(s.id) && (
                      <button
                        type="button"
                        onClick={() =>
                          run(
                            api(`${url}/enrollments`, {
                              method: 'POST',
                              body: { studentIds: [s.id] },
                            }),
                          )
                        }
                        className="font-medium text-indigo-600"
                      >
                        {c.addButton}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {batch.students.length === 0 ? (
          <p className="text-sm text-zinc-500">{c.noStudents}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {batch.students.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 font-mono text-zinc-500">{s.studentNumber}</span>
                <Link
                  href={`/${lang}/t/${tenantId}/students/${s.id}`}
                  className="flex-1 hover:underline"
                >
                  {s.fullName}
                </Link>
                {desk && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api(`${url}/enrollments/${s.id}`, { method: 'DELETE' });
                        setBatch(
                          (b) => b && { ...b, students: b.students.filter((x) => x.id !== s.id) },
                        );
                      } catch (err) {
                        fail(err);
                      }
                    }}
                    className="text-red-600"
                  >
                    {c.removeStudent}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">{c.upcoming}</h2>
        <ul className="divide-y divide-zinc-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span
                className={`flex-1 ${s.status === 'cancelled' ? 'text-zinc-400 line-through' : ''}`}
              >
                {fmtDay(s.startsAt, t.calendar)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
              </span>
              <SessionActions
                session={s}
                onChange={(next) =>
                  setSessions((all) => all.map((x) => (x.id === next.id ? next : x)))
                }
                onError={fail}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
