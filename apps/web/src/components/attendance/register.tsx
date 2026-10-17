'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { fmtDay, fmtTime } from '@/lib/datetime';
import { BackLink, card, FormError, Skeleton } from '../ui';

type Status = 'present' | 'late' | 'absent';
interface Row {
  id: string;
  studentNumber: string;
  fullName: string;
  status: Status | null;
}
interface Register {
  session: { batchName: string; subjectName: string; startsAt: string; endsAt: string };
  students: Row[];
}

const colors: Record<Status, string> = {
  present: 'border-success-solid bg-success-solid text-white',
  late: 'border-late-solid bg-late-solid text-white',
  absent: 'border-danger-solid bg-danger-solid text-white',
};

export function AttendanceRegister() {
  const { lang, t } = useI18n();
  const a = t.attendance;
  const { tenantId, sessionId } = useParams<{ tenantId: string; sessionId: string }>();
  const [data, setData] = useState<Register | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Register>(`/tenants/${tenantId}/sessions/${sessionId}/attendance`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, sessionId, t]);

  async function mark(studentId: string, status: Status) {
    try {
      await api(`/tenants/${tenantId}/sessions/${sessionId}/attendance/${studentId}`, {
        method: 'PUT',
        body: { status },
      });
      setData(
        (d) =>
          d && {
            ...d,
            students: d.students.map((s) => (s.id === studentId ? { ...s, status } : s)),
          },
      );
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  if (!data) return error ? <FormError message={error} /> : <Skeleton />;
  const count = (s: Status | null) => data.students.filter((x) => x.status === s).length;

  return (
    <div className="space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}/attendance`}>{a.back}</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">{data.session.batchName}</h1>
        <p className="text-ink-muted">
          {fmtDay(data.session.startsAt, t.calendar)} · {fmtTime(data.session.startsAt)}–
          {fmtTime(data.session.endsAt)} · {data.session.subjectName}
        </p>
        <p className="mt-1 text-sm text-ink-subtle">
          {fmt(a.summary, {
            present: count('present'),
            late: count('late'),
            absent: count('absent'),
            none: count(null),
          })}
        </p>
      </div>
      <FormError message={error} />
      <ul className={`${card} divide-y divide-line`}>
        {data.students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="w-12 font-mono text-sm text-ink-subtle">{s.studentNumber}</span>
            <span className="min-w-0 flex-1">{s.fullName}</span>
            <span className="flex gap-1" role="group" aria-label={s.fullName}>
              {(['present', 'late', 'absent'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={s.status === st}
                  onClick={() => mark(s.id, st)}
                  className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition duration-150 active:scale-95 ${s.status === st ? colors[st] : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-soft'}`}
                >
                  {a[st]}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
