'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { fmtDay, fmtTime } from '@/lib/datetime';
import { FormError } from '../ui';

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
  present: 'bg-green-600 text-white',
  late: 'bg-orange-500 text-white',
  absent: 'bg-red-600 text-white',
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

  if (!data)
    return error ? <FormError message={error} /> : <p className="text-zinc-500">{t.loading}</p>;
  const count = (s: Status | null) => data.students.filter((x) => x.status === s).length;

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/${lang}/t/${tenantId}/attendance`} className="text-sm text-indigo-600">
        {a.back}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{data.session.batchName}</h1>
        <p className="text-zinc-600">
          {fmtDay(data.session.startsAt, t.calendar)} · {fmtTime(data.session.startsAt)}–
          {fmtTime(data.session.endsAt)} · {data.session.subjectName}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {fmt(a.summary, {
            present: count('present'),
            late: count('late'),
            absent: count('absent'),
            none: count(null),
          })}
        </p>
      </div>
      <FormError message={error} />
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        {data.students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="w-12 font-mono text-sm text-zinc-500">{s.studentNumber}</span>
            <span className="min-w-0 flex-1">{s.fullName}</span>
            <span className="flex gap-1" role="group" aria-label={s.fullName}>
              {(['present', 'late', 'absent'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={s.status === st}
                  onClick={() => mark(s.id, st)}
                  className={`rounded-md px-2.5 py-1 text-sm ${s.status === st ? colors[st] : 'border border-zinc-300 bg-white text-zinc-700'}`}
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
