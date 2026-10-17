'use client';

import { Plus, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { cents, fmtMoney } from '@/lib/money';
import { useTenantData } from '../dashboard-shell';
import { Badge, btn, Button, card, ConfirmButton, FormError, FormSuccess } from '../ui';
import type { Concession, Invoice, Receipt } from './types';

interface StudentFeesData {
  concessions: Concession[];
  invoices: Invoice[];
  payments: {
    id: string;
    receiptNumber: string;
    amount: string;
    method: string;
    receivedAt: string;
  }[];
  outstanding: string;
}

/** Fees section on the student page: concessions, invoices, payments, take payment. */
export function StudentFees({
  studentId,
  classes,
}: {
  studentId: string;
  classes: { id: string; name: string }[];
}) {
  const { lang, t } = useI18n();
  const f = t.fees;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { roles } = useTenantData();
  const manager = roles.includes('owner') || roles.includes('admin');
  const base = `/tenants/${tenantId}/students/${studentId}`;
  const [data, setData] = useState<StudentFeesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', reference: '' });
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [concession, setConcession] = useState({ type: 'free_card', percent: '10', batchId: '' });

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const load = useCallback(() => {
    api<StudentFeesData>(`${base}/fees`)
      .then((d) => {
        setData(d);
        setForm((x) => ({ ...x, amount: cents(d.outstanding) > 0 ? d.outstanding : '' }));
      })
      .catch(fail);
  }, [base, fail]);
  useEffect(load, [load]);

  async function takePayment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ receipt: Receipt }>(`/tenants/${tenantId}/payments`, {
        method: 'POST',
        body: {
          studentId,
          amount: form.amount,
          method: form.method,
          reference: form.reference || null,
          clientRef,
        },
      });
      setLastReceipt(res.receipt);
      // A new submit gets a new id; repeating this one would be ignored by the server.
      setClientRef(crypto.randomUUID());
      load();
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  }

  async function addConcession(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`${base}/concessions`, {
        method: 'POST',
        body: {
          type: concession.type,
          percent: concession.type === 'percent' ? Number(concession.percent) : undefined,
          batchId: concession.batchId || null,
        },
      });
      load();
    } catch (err) {
      fail(err);
    }
  }

  if (!data) return null;
  const label = (c: Concession) =>
    c.type === 'percent' ? `${f.percent.replace('%', '')} ${Number(c.percent)}%` : f[c.type];
  return (
    <section className={`${card} max-w-xl space-y-4 p-4`}>
      <div className="flex items-center gap-3">
        <h2 className="mr-auto flex items-center gap-2 font-medium">
          <Wallet aria-hidden className="size-5 text-primary" />
          {f.title}
        </h2>
        <Badge status={cents(data.outstanding) > 0 ? 'issued' : 'paid'}>
          {fmt(f.outstandingTotal, { amount: fmtMoney(data.outstanding) })}
        </Badge>
      </div>
      <FormError message={error} />

      {cents(data.outstanding) > 0 && (
        <form
          onSubmit={takePayment}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-soft p-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            {f.amount}
            <input
              required
              inputMode="decimal"
              pattern="\d{1,10}(\.\d{1,2})?"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-32 rounded-lg border border-line-strong px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            {f.method}
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1.5"
            >
              <option value="cash">{f.cash}</option>
              <option value="bank_transfer">{f.bank_transfer}</option>
            </select>
          </label>
          {form.method === 'bank_transfer' && (
            <label className="flex flex-col gap-1">
              {f.reference}
              <input
                value={form.reference}
                maxLength={100}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                className="rounded-lg border border-line-strong px-2 py-1.5"
              />
            </label>
          )}
          <div className="w-40">
            <Button type="submit" busy={busy}>
              {f.record}
            </Button>
          </div>
        </form>
      )}
      {lastReceipt && (
        <FormSuccess>
          {fmt(f.receiptNo, { number: lastReceipt.receiptNumber })} · LKR{' '}
          {fmtMoney(lastReceipt.amount)} ·{' '}
          <Link
            href={`/${lang}/t/${tenantId}/payments/${lastReceipt.id}`}
            className="font-medium underline"
          >
            {f.receipt}
          </Link>
        </FormSuccess>
      )}

      <div>
        <h3 className="mb-1 text-sm font-medium text-ink-muted">{f.concessions}</h3>
        <ul className="space-y-1 text-sm">
          {data.concessions.length === 0 && <li className="text-ink-subtle">{f.noConcessions}</li>}
          {data.concessions.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">
                {label(c)} · {c.batchName ?? f.allClasses}
              </span>
              {manager && (
                <ConfirmButton
                  icon={Trash2}
                  onConfirm={() =>
                    api(`${base}/concessions/${c.id}`, { method: 'DELETE' }).then(load, fail)
                  }
                >
                  {f.remove}
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        {manager && (
          <form onSubmit={addConcession} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <select
              value={concession.type}
              onChange={(e) => setConcession({ ...concession, type: e.target.value })}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1"
            >
              <option value="free_card">{f.free_card}</option>
              <option value="half_card">{f.half_card}</option>
              <option value="percent">{f.percent}</option>
            </select>
            {concession.type === 'percent' && (
              <input
                type="number"
                min={1}
                max={100}
                value={concession.percent}
                onChange={(e) => setConcession({ ...concession, percent: e.target.value })}
                aria-label={f.percent}
                className="w-20 rounded-lg border border-line-strong px-2 py-1"
              />
            )}
            <select
              value={concession.batchId}
              onChange={(e) => setConcession({ ...concession, batchId: e.target.value })}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1"
            >
              <option value="">{f.allClasses}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" className={btn('link', 'none')}>
              <Plus aria-hidden className="size-4" />
              {f.addConcession}
            </button>
            <p className="w-full text-xs text-ink-subtle">{f.concessionHint}</p>
          </form>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-ink-muted">{f.invoices}</h3>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-ink-subtle">{f.noInvoices}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.invoices.map((inv) => (
              <li key={inv.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-medium">
                    {inv.period
                      ? `${t.calendar.months[Number(inv.period.slice(5)) - 1]} ${inv.period.slice(0, 4)}`
                      : fmt(f.invoiceNo, { number: inv.invoiceNumber })}
                  </span>
                  <span className="font-mono">LKR {fmtMoney(inv.total)}</span>
                  <Badge status={inv.status}>{f.status[inv.status]}</Badge>
                </div>
                <ul className="mt-1 text-xs text-ink-subtle">
                  {(inv.lines ?? []).map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="flex-1">
                        {f.kinds[l.kind]}
                        {l.kind !== 'concession' && l.description ? ` · ${l.description}` : ''}
                      </span>
                      <span className="font-mono">
                        {l.amount.startsWith('-')
                          ? `−${fmtMoney(l.amount.slice(1))}`
                          : fmtMoney(l.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.payments.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-ink-muted">{f.payments}</h3>
          <ul className="divide-y divide-line text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex gap-2 py-1.5">
                <Link
                  href={`/${lang}/t/${tenantId}/payments/${p.id}`}
                  className="flex-1 text-primary hover:underline"
                >
                  {fmt(f.receiptNo, { number: p.receiptNumber })}
                </Link>
                <span className="text-ink-subtle">{colomboDate(p.receivedAt)}</span>
                <span className="font-mono">LKR {fmtMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
