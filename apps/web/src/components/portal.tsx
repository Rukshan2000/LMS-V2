'use client';

import {
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  ListChecks,
  UsersRound,
  Video,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, fmtDay, fmtTime } from '@/lib/datetime';
import { cents, fmtMoney, fromCents } from '@/lib/money';
import { useTenantData } from './dashboard-shell';
import { PortalQuizzes } from './quizzes/portal-quizzes';
import type { PortalQuiz } from './quizzes/types';
import { SlipUpload } from './slip-upload';
import { Badge, btn, card, EmptyState, FormError, Skeleton } from './ui';

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
    online: boolean;
    feeDue: boolean;
    liveUrl: string | null;
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

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className={`${card} animate-fade-in p-4`}>
      <h3 className="mb-2 flex items-center gap-2 font-medium">
        <Icon aria-hidden className="size-5 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Home page for parents and students: one block per linked student. */
export function Portal() {
  const { t } = useI18n();
  const p = t.portal;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { entitlements } = useTenantData();
  // No uploads without the slips feature, or while the account is suspended (read-only).
  const canUpload = entitlements.features.bank_slips && entitlements.writable;
  const [children, setChildren] = useState<Child[] | null>(null);
  const [quizzes, setQuizzes] = useState<PortalQuiz[]>([]);
  const withQuizzes = entitlements.features.quizzes;
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ children: Child[] }>(`/tenants/${tenantId}/portal`)
      .then((r) => setChildren(r.children))
      .catch((err) => setError(errorMessage(t, err)));
    if (withQuizzes)
      api<{ quizzes: PortalQuiz[] }>(`/tenants/${tenantId}/portal/quizzes`)
        .then((r) => setQuizzes(r.quizzes))
        .catch(() => {});
  }, [tenantId, t, withQuizzes]);
  useEffect(load, [load]);

  if (error) return <FormError message={error} />;
  if (!children) return <Skeleton />;
  if (children.length === 0) return <EmptyState icon={UsersRound}>{p.noChildren}</EmptyState>;

  return (
    <div className="space-y-10">
      {children.map((c) => (
        <div key={c.id} className="space-y-4">
          <h2 className="flex items-center gap-3 text-xl font-semibold">
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full bg-primary text-base text-white"
            >
              {c.fullName.trim().charAt(0).toUpperCase()}
            </span>
            {c.fullName}{' '}
            <span className="rounded-lg bg-primary-soft px-2 py-0.5 font-mono text-sm text-primary-hover">
              {c.studentNumber}
            </span>
          </h2>

          <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <Section title={t.fees.title} icon={Wallet}>
              {cents(c.outstanding) === 0 ? (
                <p className="flex items-center gap-2 text-success">
                  <CircleCheck aria-hidden className="size-5" />
                  {p.allPaid}
                </p>
              ) : (
                <>
                  <p className="font-medium text-danger">
                    {fmt(t.fees.outstandingTotal, { amount: fmtMoney(c.outstanding) })}
                  </p>
                  <ul className="mt-2 divide-y divide-line text-sm">
                    {c.invoices.map((i) => (
                      <li key={i.invoiceNumber} className="flex justify-between gap-2 py-1.5">
                        <span>
                          {i.period
                            ? `${t.calendar.months[Number(i.period.slice(5)) - 1]} ${i.period.slice(0, 4)}`
                            : fmt(t.fees.invoiceNo, { number: i.invoiceNumber })}
                          <span className="ml-2 text-ink-subtle">
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
                    <li key={slip.id} className="flex flex-wrap items-center gap-2">
                      <Badge status={slip.status}>{t.slips.status[slip.status]}</Badge>
                      {colomboDate(slip.submittedAt)} · LKR {fmtMoney(slip.amount)}
                      {slip.reviewNote && <span className="text-danger">: {slip.reviewNote}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {canUpload && cents(c.outstanding) > 0 && (
                <SlipUpload studentId={c.id} outstanding={c.outstanding} onDone={load} />
              )}
              {c.payments.length > 0 && (
                <>
                  <h4 className="mt-4 text-sm text-ink-subtle">{p.recentPayments}</h4>
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

            <Section title={p.upcoming} icon={CalendarClock}>
              {c.sessions.length === 0 ? (
                <p className="text-sm text-ink-subtle">{p.noUpcoming}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {c.sessions.map((s) => (
                    <li
                      key={s.id}
                      className={`py-1.5 ${s.status === 'cancelled' ? 'text-ink-subtle line-through' : ''}`}
                    >
                      {fmtDay(s.startsAt, t.calendar)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)} ·{' '}
                      {s.batchName}
                      {s.room && <span className="text-ink-subtle"> · {s.room}</span>}
                      {s.status === 'cancelled' && (
                        <span className="ml-2 no-underline">({p.cancelled})</span>
                      )}
                      {s.status === 'scheduled' && s.liveUrl ? (
                        <a
                          href={s.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`ml-2 ${btn('success', 'xs')}`}
                        >
                          <Video aria-hidden className="size-3.5" />
                          {p.join}
                        </a>
                      ) : (
                        s.status === 'scheduled' &&
                        s.online && (
                          <span className={`ml-2 ${s.feeDue ? 'text-danger' : 'text-ink-subtle'}`}>
                            ({s.feeDue ? p.payToJoin : p.linkSoon})
                          </span>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {c.classes.length > 0 && (
                <p className="mt-3 text-xs text-ink-subtle">
                  {p.classes}: {c.classes.map((b) => `${b.name} (${b.subjectName})`).join(', ')}
                </p>
              )}
            </Section>

            {withQuizzes && (
              <Section title={t.quizzes.title} icon={ListChecks}>
                <PortalQuizzes quizzes={quizzes.filter((x) => x.studentId === c.id)} />
              </Section>
            )}

            <Section title={p.attendance} icon={ClipboardCheck}>
              {c.attendance.length === 0 ? (
                <p className="text-sm text-ink-subtle">{p.noAttendance}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {c.attendance.map((a) => (
                    <li
                      key={a.startsAt + a.batchName}
                      className="flex justify-between gap-2 py-1.5"
                    >
                      <span>
                        {fmtDay(a.startsAt, t.calendar)} · {a.batchName}
                      </span>
                      <Badge status={a.status}>{t.attendance[a.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      ))}
    </div>
  );
}
