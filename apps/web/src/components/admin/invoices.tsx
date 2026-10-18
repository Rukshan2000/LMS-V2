'use client';

import { Download, FileText, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { addDays, colomboDate } from '@/lib/datetime';
import { cents, fmtMoney, fromCents } from '@/lib/money';
import {
  Badge,
  btn,
  Button,
  ConfirmButton,
  EmptyState,
  FormError,
  FormSuccess,
  Skeleton,
} from '../ui';
import { Table, Td, type Invoice } from './shared';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function InvoicesPage() {
  const { lang, t } = useI18n();
  const iv = t.admin.invoices;
  // Default: last month, the one to invoice on the 1st.
  const [period, setPeriod] = useState(addDays(`${colomboDate().slice(0, 7)}-01`, -1).slice(0, 7));
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [preview, setPreview] = useState<{ accountName: string; total: string }[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const load = useCallback(() => {
    api<{ invoices: Invoice[] }>(`/admin/invoices?period=${period}`)
      .then((r) => setInvoices(r.invoices))
      .catch(fail);
  }, [period, fail]);
  useEffect(load, [load]);

  function changeMonth(value: string) {
    if (!value) return;
    setPeriod(value);
    setInvoices(null);
    setPreview(null);
    setDone(null);
    setError(null);
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        (await api<{ preview: typeof preview }>(`/admin/invoices/preview?period=${period}`))
          .preview,
      );
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  }

  async function generate() {
    setBusy(true);
    try {
      const res = await api<{ invoices: unknown[] }>('/admin/invoices/generate', {
        method: 'POST',
        body: { period },
      });
      setDone(fmt(iv.generated, { count: res.invoices.length }));
      setPreview(null);
      load();
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  }

  function downloadCsv() {
    const head = [
      'number',
      'account',
      'owner_email',
      'owner_phone',
      'period',
      'total',
      'paid',
      'status',
      'due_date',
    ];
    const lines = (invoices ?? []).map((i) =>
      [
        i.number,
        i.accountName ?? '',
        i.ownerEmail ?? '',
        i.ownerPhone ?? '',
        i.period,
        i.total,
        i.paid,
        i.status,
        i.dueDate,
      ]
        .map(csvCell)
        .join(','),
    );
    const url = URL.createObjectURL(
      new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscription-invoices-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const previewTotal = fromCents((preview ?? []).reduce((sum, p) => sum + cents(p.total), 0));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{iv.title}</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-ink-muted">
          {iv.month}
          <input
            type="month"
            value={period}
            onChange={(e) => changeMonth(e.target.value)}
            className="mt-1 block rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink"
          />
        </label>
        <Button
          full={false}
          size="sm"
          variant="secondary"
          icon={ListChecks}
          busy={busy}
          onClick={check}
        >
          {iv.check}
        </Button>
        {invoices && invoices.length > 0 && (
          <button type="button" onClick={downloadCsv} className={btn('secondary')}>
            <Download aria-hidden className="size-4" />
            {iv.csv}
          </button>
        )}
      </div>
      <FormError message={error} />
      {done && <FormSuccess>{done}</FormSuccess>}
      {preview &&
        (preview.length === 0 ? (
          <p className="text-sm text-ink-subtle">{iv.nothing}</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {fmt(iv.preview, { count: preview.length, total: fmtMoney(previewTotal) })}
            </p>
            <ul className="text-sm">
              {preview.map((p) => (
                <li key={p.accountName}>
                  {p.accountName}: LKR {fmtMoney(p.total)}
                </li>
              ))}
            </ul>
            <ConfirmButton icon={FileText} onConfirm={generate}>
              {fmt(iv.generate, { month: period })}
            </ConfirmButton>
          </div>
        ))}
      {!invoices ? (
        <Skeleton />
      ) : invoices.length === 0 ? (
        <EmptyState icon={FileText}>{iv.empty}</EmptyState>
      ) : (
        <Table head={[iv.number, iv.account, iv.total, iv.paid, iv.status, iv.dueDate]}>
          {invoices.map((i) => (
            <tr key={i.id}>
              <Td>
                <span className="font-mono">{i.number}</span>
              </Td>
              <Td>
                <Link
                  href={`/${lang}/admin/accounts/${i.accountId}`}
                  className="text-primary hover:text-primary-hover"
                >
                  {i.accountName}
                </Link>
              </Td>
              <Td num>{fmtMoney(i.total)}</Td>
              <Td num>{fmtMoney(i.paid)}</Td>
              <Td>
                <Badge status={i.status === 'open' ? 'issued' : i.status}>
                  {iv.statuses[i.status]}
                </Badge>
              </Td>
              <Td>{i.dueDate}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
