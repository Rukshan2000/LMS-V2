'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, fmtDay, fmtTime } from '@/lib/datetime';
import { cents, fmtMoney, fromCents } from '@/lib/money';
import { SlipUpload } from './slip-upload';
import { FormError } from './ui';

interface Child {
  id: string;
  fullName: string;
  studentNumber: string;
  classes: { id: string; name: string; subjectName: string }[];
  sessions: {
    id: string;
    batchName: string;
    startsAt: string;
    endsAt: string;
    status: 'scheduled' | 'cancelled';
    room: string | null;
  }[];
  attendance: { status: 'present' | 'late' | 'absent'; batchName: string; startsAt: string }[];
  invoices: {
    invoiceNumber: string;
    period: string | null;
    dueDate: string;
    total: string;
    paid: string;
  }[];
  payments: { receiptNumber: string; amount: string; receivedAt: string }[];
  slips: {
    id: string;
    amount: string;
    status: 'pending' | 'rejected';
    reviewNote: string | null;
    submittedAt: string;
  }[];
  outstanding: string;
}

const STATUS_COLOR = {
  present: 'bg-green-100 text-green-800',
  late: 'bg-amber-100 text-amber-800',
  absent: 'bg-red-100 text-red-800',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="mb-2 font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** Home page for parents and students: one block per linked student. */
export function Portal() {
  const { t } = useI18n();
  const p = t.portal;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ children: Child[] }>(`/tenants/${tenantId}/portal`)
      .then((r) => setChildren(r.children))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, t]);
  useEffect(load, [load]);

  if (error) return <FormError message={error} />;
  if (!children) return <p className="text-zinc-500">{t.loading}</p>;
  if (children.length === 0) return <p className="text-zinc-600">{p.noChildren}</p>;

  return (
    <div className="max-w-3xl space-y-10">
      {children.map((c) => (
        <div key={c.id} className="space-y-4">
          <h2 className="text-xl font-semibold">
            {c.fullName} <span className="font-mono text-sm text-zinc-500">{c.studentNumber}</span>
          </h2>

          <Section title={t.fees.title}>
            {cents(c.outstanding) === 0 ? (
              <p className="text-green-700">{p.allPaid}</p>
            ) : (
              <>
                <p className="font-medium text-red-700">
                  {fmt(t.fees.outstandingTotal, { amount: fmtMoney(c.outstanding) })}
                </p>
                <ul className="mt-2 divide-y divide-zinc-100 text-sm">
                  {c.invoices.map((i) => (
                    <li key={i.invoiceNumber} className="flex justify-between gap-2 py-1.5">
                      <span>
                        {i.period
                          ? `${t.calendar.months[Number(i.period.slice(5)) - 1]} ${i.period.slice(0, 4)}`
                          : fmt(t.fees.invoiceNo, { number: i.invoiceNumber })}
                        <span className="ml-2 text-zinc-500">
                          {t.fees.due} {i.dueDate}
                        </span>
                      </span>
                      <span className="font-mono">
                        {fmtMoney(fromCents(cents(i.total) - cents(i.paid)))}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {c.slips.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {c.slips.map((slip) => (
                  <li
                    key={slip.id}
                    className={slip.status === 'pending' ? 'text-amber-700' : 'text-red-700'}
                  >
                    {colomboDate(slip.submittedAt)} · LKR {fmtMoney(slip.amount)} ·{' '}
                    {t.slips.status[slip.status]}
                    {slip.reviewNote && `: ${slip.reviewNote}`}
                  </li>
                ))}
              </ul>
            )}
            {cents(c.outstanding) > 0 && (
              <SlipUpload studentId={c.id} outstanding={c.outstanding} onDone={load} />
            )}
            {c.payments.length > 0 && (
              <>
                <h4 className="mt-4 text-sm text-zinc-500">{p.recentPayments}</h4>
                <ul className="text-sm">
                  {c.payments.map((pay) => (
                    <li key={pay.receiptNumber} className="flex justify-between gap-2 py-1">
                      <span>
                        {colomboDate(pay.receivedAt)} ·{' '}
                        {fmt(t.fees.receiptNo, { number: pay.receiptNumber })}
                      </span>
                      <span className="font-mono">{fmtMoney(pay.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section title={p.upcoming}>
            {c.sessions.length === 0 ? (
              <p className="text-sm text-zinc-500">{p.noUpcoming}</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {c.sessions.map((s) => (
                  <li
                    key={s.id}
                    className={`py-1.5 ${s.status === 'cancelled' ? 'text-zinc-400 line-through' : ''}`}
                  >
                    {fmtDay(s.startsAt, t.calendar)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)} ·{' '}
                    {s.batchName}
                    {s.room && <span className="text-zinc-500"> · {s.room}</span>}
                    {s.status === 'cancelled' && (
                      <span className="ml-2 no-underline">({p.cancelled})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {c.classes.length > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                {p.classes}: {c.classes.map((b) => `${b.name} (${b.subjectName})`).join(', ')}
              </p>
            )}
          </Section>

          <Section title={p.attendance}>
            {c.attendance.length === 0 ? (
              <p className="text-sm text-zinc-500">{p.noAttendance}</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {c.attendance.map((a) => (
                  <li key={a.startsAt + a.batchName} className="flex justify-between gap-2 py-1.5">
                    <span>
                      {fmtDay(a.startsAt, t.calendar)} · {a.batchName}
                    </span>
                    <span className={`rounded px-2 text-xs leading-5 ${STATUS_COLOR[a.status]}`}>
                      {t.attendance[a.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      ))}
    </div>
  );
}
