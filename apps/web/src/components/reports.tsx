'use client';

import { Banknote, ChevronRight, ClipboardCheck, Download, Wallet } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { btn, card, FormError } from './ui';

interface Summary {
  months: { period: string; invoices: number; billed: string; paid: string; outstanding: string }[];
  received: { month: string; method: string; payments: number; amount: string }[];
  daily: { day: string; payments: number; amount: string }[];
  attendance: {
    batchId: string;
    name: string;
    sessions: number;
    present: number;
    late: number;
    absent: number;
    enrolled: number;
  }[];
}

function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className="bg-surface-soft text-left text-ink-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-soft/60">
          {children}
        </tbody>
      </table>
    </div>
  );
}
const Num = ({ children }: { children: ReactNode }) => (
  <td className="px-3 py-2 text-right font-mono">{children}</td>
);

/** Owner/admin reports: fees per month, money received, attendance per class, CSV exports. */
export function Reports() {
  const { t } = useI18n();
  const r = t.reports;
  const f = t.fees;
  const { tenantId } = useParams<{ tenantId: string }>();
  const thisMonth = colomboDate().slice(0, 7);
  const [from, setFrom] = useState(`${thisMonth.slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/tenants/${tenantId}/reports`;
  const range = `from=${from}&to=${to}`;
  const monthName = (p: string) => `${t.calendar.months[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
  const pct = (n: number, d: number) => (d ? `${Math.round((n * 100) / d)}%` : '–');

  useEffect(() => {
    api<Summary>(`${base}/summary?${range}`)
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [base, range, t]);

  const csv = (name: string, withRange = false) => (
    <a
      href={`/api/v1${base}/${name}.csv${withRange ? `?${range}` : ''}`}
      download
      className={btn('secondary')}
    >
      <Download aria-hidden className="size-4" />
      {r.csv[name as keyof typeof r.csv]}
    </a>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.nav.reports}</h1>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="block text-ink-muted">{r.from}</span>
          <input
            type="month"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="mt-1 rounded-lg border border-line-strong px-2 py-1.5"
          />
        </label>
        <label>
          <span className="block text-ink-muted">{r.to}</span>
          <input
            type="month"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="mt-1 rounded-lg border border-line-strong px-2 py-1.5"
          />
        </label>
      </div>
      <FormError message={error} />

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Wallet aria-hidden className="size-5 text-primary" />
          {r.feesByMonth}
        </h2>
        <Table head={[f.month, r.invoices, f.billed, f.collected, f.outstanding]}>
          {data?.months.map((m) => (
            <tr key={m.period}>
              <td className="px-3 py-2">{monthName(m.period)}</td>
              <Num>{m.invoices}</Num>
              <Num>{fmtMoney(m.billed)}</Num>
              <Num>{fmtMoney(m.paid)}</Num>
              <Num>{fmtMoney(m.outstanding)}</Num>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Banknote aria-hidden className="size-5 text-primary" />
          {r.received}
        </h2>
        <Table head={[f.month, f.method, f.payments, f.amount]}>
          {data?.received.map((m) => (
            <tr key={m.month + m.method}>
              <td className="px-3 py-2">{monthName(m.month)}</td>
              <td className="px-3 py-2 text-right">{f[m.method as 'cash']}</td>
              <Num>{m.payments}</Num>
              <Num>{fmtMoney(m.amount)}</Num>
            </tr>
          ))}
        </Table>
      </section>

      <details className="group space-y-2">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg font-medium transition-colors hover:text-primary [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-5 text-primary transition-transform duration-200 group-open:rotate-90"
          />
          {r.daily}
        </summary>
        <Table head={[f.date, f.payments, f.amount]}>
          {data?.daily.map((d) => (
            <tr key={d.day}>
              <td className="px-3 py-2">{d.day}</td>
              <Num>{d.payments}</Num>
              <Num>{fmtMoney(d.amount)}</Num>
            </tr>
          ))}
        </Table>
      </details>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-medium">
          <ClipboardCheck aria-hidden className="size-5 text-primary" />
          {r.attendance}
        </h2>
        <Table
          head={[
            r.class,
            r.sessions,
            r.enrolled,
            t.attendance.present,
            t.attendance.late,
            t.attendance.absent,
            r.rate,
          ]}
        >
          {data?.attendance.map((a) => (
            <tr key={a.batchId}>
              <td className="px-3 py-2">{a.name}</td>
              <Num>{a.sessions}</Num>
              <Num>{a.enrolled}</Num>
              <Num>{a.present}</Num>
              <Num>{a.late}</Num>
              <Num>{a.absent}</Num>
              <Num>{pct(a.present + a.late, a.sessions * a.enrolled)}</Num>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Download aria-hidden className="size-5 text-primary" />
          {r.exports}
        </h2>
        <div className="flex flex-wrap gap-2">
          {csv('payments', true)}
          {csv('unpaid')}
          {csv('students')}
        </div>
      </section>
    </div>
  );
}
