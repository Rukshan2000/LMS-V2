'use client';

import {
  CircleAlert,
  CircleCheck,
  FilePlus,
  FileText,
  MessageCircle,
  PartyPopper,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { btn, card, FormError, FormSuccess, Skeleton } from '../ui';

interface Unpaid {
  invoiceId: string;
  studentId: string;
  studentNumber: string;
  fullName: string;
  balance: string;
  dueDate: string;
  guardians: { fullName: string; phone: string }[];
}
interface Month {
  summary: { invoices: number; billed: string; collected: string; outstanding: string };
  unpaid: Unpaid[];
}

export function FeesMonth() {
  const { lang, t } = useI18n();
  const f = t.fees;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { tenant } = useTenantData();
  const [period, setPeriod] = useState(() => colomboDate().slice(0, 7));
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Month>(`/tenants/${tenantId}/fees/month?period=${period}`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, period, t]);
  useEffect(load, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invoicesCreated: number; linesAdded: number }>(
        `/tenants/${tenantId}/invoices/generate`,
        {
          method: 'POST',
          body: { period },
        },
      );
      setNotice(fmt(f.generated, { created: r.invoicesCreated, lines: r.linesAdded }));
      load();
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  const monthName = `${t.calendar.months[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{f.title}</h1>
        <label className="text-sm text-ink-muted">
          {f.month}{' '}
          <input
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="ml-1 rounded-lg border border-line-strong px-2 py-1"
          />
        </label>
        <button type="button" disabled={busy} onClick={generate} className={btn('primary', 'md')}>
          <FilePlus aria-hidden className="size-4" />
          {f.generate}
        </button>
      </div>
      {notice && <FormSuccess>{notice}</FormSuccess>}
      <FormError message={error} />
      {!data && !error && <Skeleton rows={3} />}
      {data && (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ['billed', FileText, 'text-primary'],
                ['collected', CircleCheck, 'text-success'],
                ['outstanding', CircleAlert, 'text-danger'],
              ] as const
            ).map(([k, Icon, color]) => (
              <div key={k} className={`${card} p-3 sm:p-4`}>
                <dt className="flex items-center gap-1.5 text-sm text-ink-subtle">
                  <Icon aria-hidden className={`size-4 shrink-0 ${color}`} />
                  {f[k]}
                </dt>
                <dd className="mt-1 font-mono text-base font-semibold sm:text-lg">
                  <span className="mr-1 text-xs font-normal text-ink-subtle">LKR</span>
                  {fmtMoney(data.summary[k])}
                </dd>
              </div>
            ))}
          </dl>
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-line bg-surface-soft px-4 py-2 font-medium">
              {f.notPaid} ({data.unpaid.length})
            </h2>
            {data.unpaid.length === 0 ? (
              <p className="flex items-center gap-2 p-4 text-sm text-ink-subtle">
                {data.summary.invoices ? (
                  <PartyPopper aria-hidden className="size-4 text-success" />
                ) : (
                  <FileText aria-hidden className="size-4" />
                )}
                {data.summary.invoices ? f.allPaid : f.noInvoices}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.unpaid.map((u) => (
                  <li
                    key={u.invoiceId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
                  >
                    <span className="w-12 font-mono text-ink-subtle">{u.studentNumber}</span>
                    <Link
                      href={`/${lang}/t/${tenantId}/students/${u.studentId}`}
                      className="min-w-0 flex-1 font-medium hover:underline"
                    >
                      {u.fullName}
                    </Link>
                    <span className="font-mono">LKR {fmtMoney(u.balance)}</span>
                    {u.guardians.map((g) => (
                      <a
                        key={g.phone}
                        href={waLink(
                          g.phone,
                          fmt(f.reminder, {
                            month: monthName,
                            student: u.fullName,
                            amount: fmtMoney(u.balance),
                            due: u.dueDate,
                            institute: tenant.name,
                          }),
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className={btn('whatsapp', 'xs')}
                      >
                        <MessageCircle aria-hidden className="size-3.5" />
                        {f.remind}: {g.fullName}
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
