'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, colomboTime } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';
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

  if (!receipt)
    return error ? <FormError message={error} /> : <p className="text-zinc-500">{t.loading}</p>;
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
        <Link
          href={`/${lang}/t/${tenantId}/students/${receipt.studentId}`}
          className="mr-auto text-sm text-indigo-600"
        >
          ← {receipt.studentName}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          {f.print}
        </button>
        {guardians.map((g) => (
          <a
            key={g.phone}
            href={waLink(g.phone, message)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            {f.sendReceipt}
          </a>
        ))}
      </div>
      <article className="space-y-3 rounded-xl border border-zinc-300 bg-white p-6">
        <header className="text-center">
          <p className="text-lg font-semibold">{tenant.name}</p>
          <p className="text-sm text-zinc-600">
            {f.receipt} · {fmt(f.receiptNo, { number: receipt.receiptNumber })}
          </p>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">{f.date}</dt>
          <dd>
            {colomboDate(receipt.receivedAt)} {colomboTime(receipt.receivedAt)}
          </dd>
          <dt className="text-zinc-500">{f.student}</dt>
          <dd>
            {receipt.studentNumber} · {receipt.studentName}
          </dd>
          <dt className="text-zinc-500">{f.method}</dt>
          <dd>
            {f[receipt.method]}
            {receipt.reference ? ` · ${receipt.reference}` : ''}
          </dd>
          {receipt.receivedBy && (
            <>
              <dt className="text-zinc-500">{f.receivedBy}</dt>
              <dd>{receipt.receivedBy}</dd>
            </>
          )}
        </dl>
        <table className="w-full text-sm">
          <caption className="text-left text-zinc-500">{f.paidFor}</caption>
          <tbody>
            {receipt.allocations.map((a) => (
              <tr key={a.invoiceId} className="border-t border-zinc-100">
                <td className="py-1">{period(a.period, a.invoiceNumber)}</td>
                <td className="py-1 text-right font-mono">{fmtMoney(a.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 font-semibold">
              <td className="py-1">LKR</td>
              <td className="py-1 text-right font-mono">{fmtMoney(receipt.amount)}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
