'use client';

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarDays,
  Lock,
  Plus,
  Search,
  Trash2,
  UserMinus,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { addDays, colomboDate, fmtDay, fmtTime, weekdayName } from '@/lib/datetime';
import { useTenantData } from '../dashboard-shell';
import { BackLink, btn, ConfirmButton, FormError, Skeleton, Tabs } from '../ui';
import type { StudentRow } from '../students/types';
import { teachersOf, type BatchDetail, type Member, type Session } from './types';
import { ClassFees } from '../fees/class-fees';
import { SessionActions } from './session-actions';

const input = 'rounded-lg border border-line-strong bg-surface px-2 py-1.5';

export function ClassDetail() {
  const { lang, t } = useI18n();
  const c = t.classes;
  const { tenantId, batchId } = useParams<{ tenantId: string; batchId: string }>();
  const { roles, entitlements } = useTenantData();
  const liveLinks = entitlements.features.live_links;
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
  const [teachers, setTeachers] = useState<Member[]>([]);

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

  // Managers can assign or change the teacher here (a class can be created without one).
  useEffect(() => {
    if (!manager) return;
    api<{ members: Member[] }>(`/tenants/${tenantId}/members`)
      .then((r) => setTeachers(teachersOf(r.members)))
      .catch(fail);
  }, [manager, tenantId, fail]);

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

  if (!batch) return error ? <FormError message={error} /> : <Skeleton />;
  const enrolled = new Set(batch.students.map((s) => s.id));

  return (
    <div className="space-y-6">
      <BackLink href={`/${lang}/t/${tenantId}/classes`}>{c.back}</BackLink>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{batch.name}</h1>
          <p className="text-ink-muted">
            {[batch.subjectName, !manager && (batch.teacherName ?? c.noTeacher), c[batch.mode]]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {manager && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <span className="font-medium text-ink-muted">{c.teacher}</span>
              <select
                value={batch.teacherMembershipId ?? ''}
                onChange={(e) =>
                  run(
                    api(url, {
                      method: 'PATCH',
                      body: { teacherMembershipId: e.target.value || null },
                    }),
                  )
                }
                className={input}
              >
                <option value="">{c.noTeacher}</option>
                {/* Keep the current teacher listed even if they no longer have a teaching role. */}
                {batch.teacherMembershipId &&
                  !teachers.some((m) => m.membershipId === batch.teacherMembershipId) && (
                    <option value={batch.teacherMembershipId}>{batch.teacherName}</option>
                  )}
                {teachers.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            className={btn('secondary')}
          >
            {batch.status === 'active' ? (
              <Archive aria-hidden className="size-4" />
            ) : (
              <ArchiveRestore aria-hidden className="size-4" />
            )}
            {batch.status === 'active' ? c.archive : c.restore}
          </button>
        )}
      </div>
      <FormError message={error} />

      {!manager && batch.liveUrl && (
        <div>
          <a href={batch.liveUrl} target="_blank" rel="noreferrer" className={btn('primary', 'md')}>
            <Video aria-hidden className="size-4" />
            {c.liveUrl}
          </a>
        </div>
      )}

      <Tabs
        items={[
          {
            id: 'students',
            icon: Users,
            label: (
              <>
                {t.students.title}
                <span className="rounded-full bg-surface-soft px-2 text-xs text-ink-muted">
                  {batch.students.length}
                </span>
              </>
            ),
            content: (
              <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
                {desk && (
                  <div className="relative">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-subtle"
                    />
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={c.searchStudents}
                      aria-label={c.searchStudents}
                      className="w-full rounded-lg border border-line-strong py-2 pr-3 pl-9"
                    />
                    {searching && found.length > 0 && (
                      <ul className="mt-1 animate-fade-in divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
                        {found.map((s) => (
                          <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <span className="w-12 font-mono text-ink-subtle">
                              {s.studentNumber}
                            </span>
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
                                className={btn('link', 'none')}
                              >
                                <Plus aria-hidden className="size-4" />
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
                  <p className="text-sm text-ink-subtle">{c.noStudents}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {batch.students.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-12 font-mono text-ink-subtle">{s.studentNumber}</span>
                        <Link
                          href={`/${lang}/t/${tenantId}/students/${s.id}`}
                          className="flex-1 hover:underline"
                        >
                          {s.fullName}
                        </Link>
                        {desk && (
                          <ConfirmButton
                            icon={UserMinus}
                            onConfirm={async () => {
                              try {
                                await api(`${url}/enrollments/${s.id}`, { method: 'DELETE' });
                                setBatch(
                                  (b) =>
                                    b && {
                                      ...b,
                                      students: b.students.filter((x) => x.id !== s.id),
                                    },
                                );
                              } catch (err) {
                                fail(err);
                              }
                            }}
                          >
                            {c.removeStudent}
                          </ConfirmButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ),
          },
          {
            id: 'schedule',
            icon: CalendarDays,
            label: c.schedule,
            content: (
              <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
                {batch.schedule.length === 0 && (
                  <p className="text-sm text-ink-subtle">{c.noSchedule}</p>
                )}
                <ul className="divide-y divide-line">
                  {batch.schedule.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2">
                      <span className="flex-1">
                        {weekdayName(s.weekday, t.calendar)} {s.startTime}–{s.endTime}
                        {s.room && <span className="text-ink-subtle"> · {s.room}</span>}
                      </span>
                      {manager && (
                        <ConfirmButton
                          icon={Trash2}
                          onConfirm={() =>
                            run(api(`${url}/schedule/${s.id}`, { method: 'DELETE' }))
                          }
                        >
                          <span className="text-sm">{c.remove}</span>
                        </ConfirmButton>
                      )}
                    </li>
                  ))}
                </ul>
                {manager && (
                  <form
                    onSubmit={addSlot}
                    className="flex flex-wrap items-end gap-2 border-t border-line pt-3 text-sm"
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
                    <button type="submit" className={btn()}>
                      <Plus aria-hidden className="size-4" />
                      {c.addTime}
                    </button>
                  </form>
                )}
              </section>
            ),
          },
          {
            id: 'sessions',
            icon: CalendarClock,
            label: c.upcoming,
            content: (
              <section className="rounded-xl border border-line bg-surface p-4">
                <ul className="divide-y divide-line">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <span
                        className={`flex-1 ${s.status === 'cancelled' ? 'text-ink-subtle line-through' : ''}`}
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
            ),
          },
          manager && {
            id: 'fees',
            icon: Wallet,
            label: t.fees.classFees,
            content: <ClassFees batchId={batch.id} />,
          },
          manager && {
            id: 'live',
            icon: Video,
            label: c.liveTab,
            content: (
              <form
                key={batch.liveUrl ?? ''}
                onSubmit={(e) => {
                  e.preventDefault();
                  const liveUrl =
                    String(new FormData(e.currentTarget).get('liveUrl')).trim() || null;
                  void run(api(url, { method: 'PATCH', body: { liveUrl } }));
                }}
                className="space-y-2 rounded-xl border border-line bg-surface p-4 text-sm"
              >
                <label className="block">
                  <span className="flex items-center gap-2 font-medium">
                    <Video aria-hidden className="size-4 text-primary" />
                    {c.liveUrl}
                  </span>
                  <span className="flex items-center gap-1.5 text-ink-subtle">
                    {!liveLinks && <Lock aria-hidden className="size-3.5" />}
                    {liveLinks ? c.liveUrlHint : t.locked.body}
                  </span>
                  <input
                    disabled={!liveLinks}
                    name="liveUrl"
                    type="url"
                    pattern="https://.*"
                    defaultValue={batch.liveUrl ?? ''}
                    placeholder="https://zoom.us/j/…"
                    className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2"
                  />
                </label>
                <button type="submit" disabled={!liveLinks} className={btn('secondary')}>
                  {c.saveLink}
                </button>
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
