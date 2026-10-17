'use client';

import { MessageCircle, Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, colomboTime } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { BackLink, btn, FormError, Skeleton } from '../ui';
import type { Receipt } from './types';

interface Guardian {
  fullName: string;
  phone: string;
}

export function ReceiptPage() {
  const { lang, t } = useI18n();
  const f = t.fees;
  const { tenantId, paymentId } = useParams<{ tenantId: string; paymentId: string }>();
  const { tenant } = useTenantData();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ receipt: Receipt }>(`/tenants/${tenantId}/payments/${paymentId}`)
      .then(async ({ receipt }) => {
        setReceipt(receipt);
        const { student } = await api<{ student: { guardians: Guardian[] } }>(
          `/tenants/${tenantId}/students/${receipt.studentId}`,
        );
        setGuardians(student.guardians);
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, paymentId, t]);

  if (!receipt) return error ? <FormError message={error} /> : <Skeleton />;
  const message = fmt(f.receiptMessage, {
    amount: fmtMoney(receipt.amount),
    student: receipt.studentName,
    number: receipt.receiptNumber,
    institute: tenant.name,
  });
  const period = (p: string | null, n: string) =>
    p
      ? `${t.calendar.months[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`
      : fmt(f.invoiceNo, { number: n });

  return (
    <div className="max-w-md space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <span className="mr-auto">
          <BackLink href={`/${lang}/t/${tenantId}/students/${receipt.studentId}`}>
            {receipt.studentName}
          </BackLink>
        </span>
        <button type="button" onClick={() => window.print()} className={btn('secondary')}>
          <Printer aria-hidden className="size-4" />
          {f.print}
        </button>
        {guardians.map((g) => (
          <a
            key={g.phone}
            href={waLink(g.phone, message)}
            target="_blank"
            rel="noreferrer"
            className={btn('whatsapp')}
          >
            <MessageCircle aria-hidden className="size-4" />
            {f.sendReceipt}
          </a>
        ))}
      </div>
      <article className="animate-pop-in space-y-3 rounded-xl border border-line-strong bg-surface p-6 shadow-card">
        <header className="text-center">
          <p className="text-lg font-semibold">{tenant.name}</p>
          <p className="text-sm text-ink-muted">
            {f.receipt} · {fmt(f.receiptNo, { number: receipt.receiptNumber })}
          </p>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-subtle">{f.date}</dt>
          <dd>
            {colomboDate(receipt.receivedAt)} {colomboTime(receipt.receivedAt)}
          </dd>
          <dt className="text-ink-subtle">{f.student}</dt>
          <dd>
            {receipt.studentNumber} · {receipt.studentName}
          </dd>
          <dt className="text-ink-subtle">{f.method}</dt>
          <dd>
            {f[receipt.method]}
            {receipt.reference ? ` · ${receipt.reference}` : ''}
          </dd>
          {receipt.receivedBy && (
            <>
              <dt className="text-ink-subtle">{f.receivedBy}</dt>
              <dd>{receipt.receivedBy}</dd>
            </>
          )}
        </dl>
        <table className="w-full text-sm">
          <caption className="text-left text-ink-subtle">{f.paidFor}</caption>
          <tbody>
            {receipt.allocations.map((a) => (
              <tr key={a.invoiceId} className="border-t border-line">
                <td className="py-1">{period(a.period, a.invoiceNumber)}</td>
                <td className="py-1 text-right font-mono">{fmtMoney(a.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink-subtle font-semibold">
              <td className="py-1">LKR</td>
              <td className="py-1 text-right font-mono">{fmtMoney(receipt.amount)}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
