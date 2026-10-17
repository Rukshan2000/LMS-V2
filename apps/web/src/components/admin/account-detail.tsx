'use client';

import { Ban, CalendarPlus, CircleCheck, RefreshCw, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { cents, fmtMoney, fromCents } from '@/lib/money';
import { displayPhone } from '../students/types';
import { BackLink, Badge, Button, card, ConfirmButton, Field, FormError, useToast } from '../ui';
import {
  HEADS,
  HeadCounts,
  StateBadge,
  Table,
  Td,
  keyKind,
  parseValue,
  showValue,
  type AccountSummary,
  type AuditEvent,
  type Head,
  type Invoice,
  type PriceBook,
} from './shared';
import { AuditRows } from './audit';

interface Detail {
  account: AccountSummary & { notes: string | null; suspendedReason: string | null };
  book: { key: string; name: string; values: Record<string, unknown> };
  overrides: {
    key: string;
    value: unknown;
    expiresAt: string | null;
    note: string;
    createdBy: string | null;
  }[];
  institutes: { id: string; name: string; slug: string; status: string }[];
  invoices: Invoice[];
  payments: {
    id: string;
    number: string;
    amount: string;
    reference: string | null;
    receivedAt: string;
  }[];
  month: {
    days: ({ day: string } & Record<Head, number>)[];
    headsNow: Record<Head, number>;
    estimate: { total: string };
  };
  audit: AuditEvent[];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

const input =
  'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm disabled:opacity-60';

export function AccountDetail() {
  const { lang, t } = useI18n();
  const d = t.admin.detail;
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const load = useCallback(() => {
    api<Detail>(`/admin/accounts/${id}`).then(setData).catch(fail);
  }, [id, fail]);
  useEffect(() => {
    load();
    api<{ priceBooks: PriceBook[]; keys: string[] }>('/admin/price-books')
      .then((r) => {
        setBooks(r.priceBooks);
        setKeys(r.keys);
      })
      .catch(fail);
  }, [load, fail]);

  /** Run a change, then reload so state, values and history are fresh. */
  async function run(path: string, method: string, body?: unknown) {
    setError(null);
    try {
      await api(`/admin${path}`, { method, body });
      toast(d.saved);
      load();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  if (!data) return <FormError message={error} />;
  const { account } = data;
  const maxDay = Math.max(1, ...data.month.days.map((x) => x.student));

  return (
    <div className="space-y-6">
      <BackLink href={`/${lang}/admin`}>{d.back}</BackLink>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{account.name}</h1>
        <StateBadge state={account.state} />
      </div>
      <FormError message={error} />

      <section className={`${card} grid gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4`}>
        <Info label={d.ownerPhone}>
          {account.ownerName ?? t.admin.accounts.unclaimed} · {displayPhone(account.ownerPhone)}
        </Info>
        <Info label={d.priceBook}>{account.priceBook}</Info>
        <Info label={d.trialEnds}>
          {account.trialEndsAt ? colomboDate(account.trialEndsAt) : d.none}
          {account.daysLeft !== null &&
            ` (${fmt(t.admin.accounts.daysLeft, { days: account.daysLeft })})`}
        </Info>
        <Info label={d.createdAt}>{colomboDate(account.createdAt)}</Info>
        {account.suspendedAt && (
          <p className="text-danger sm:col-span-2 lg:col-span-4">
            {fmt(d.suspendedSince, {
              date: colomboDate(account.suspendedAt),
              reason: account.suspendedReason ?? '',
            })}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={d.extendTrial}>
          <TrialForm onSubmit={(days) => run(`/accounts/${id}/trial`, 'POST', { days })} />
        </Section>
        <Section title={account.suspendedAt ? d.unsuspend : d.suspend}>
          {account.suspendedAt ? (
            <ConfirmButton
              icon={CircleCheck}
              onConfirm={() => run(`/accounts/${id}/unsuspend`, 'POST')}
            >
              {d.unsuspend}
            </ConfirmButton>
          ) : (
            <ReasonForm
              label={d.reason}
              action={d.suspend}
              icon={Ban}
              onSubmit={(reason) => run(`/accounts/${id}/suspend`, 'POST', { reason })}
            />
          )}
        </Section>
      </div>

      <Section title={d.name}>
        <AccountForm
          key={JSON.stringify([account.name, account.notes, account.priceBook])}
          account={account}
          books={books}
          onSubmit={(patch) => run(`/accounts/${id}`, 'PATCH', patch)}
        />
      </Section>

      <Section title={d.values}>
        <Table head={[d.key, `${d.bookValue} (${data.book.key})`, d.overrideValue, '']}>
          {keys.map((key) => {
            const o = data.overrides.find((x) => x.key === key);
            return (
              <tr key={key} className={o ? 'bg-warning-soft/60' : undefined}>
                <Td>
                  <code>{key}</code>
                </Td>
                <Td>{key in data.book.values ? showValue(data.book.values[key], d) : '–'}</Td>
                <Td>
                  {o && (
                    <>
                      <span className="font-medium">{showValue(o.value, d)}</span>
                      <span className="block text-xs text-ink-subtle">
                        {o.note}
                        {o.expiresAt && ` · ${fmt(d.until, { date: colomboDate(o.expiresAt) })}`}
                      </span>
                    </>
                  )}
                </Td>
                <Td>
                  {o && (
                    <ConfirmButton
                      icon={Trash2}
                      onConfirm={() => run(`/accounts/${id}/overrides/${key}`, 'DELETE')}
                    >
                      {d.remove}
                    </ConfirmButton>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        <h3 className="pt-2 text-sm font-medium">{d.setOverride}</h3>
        <OverrideForm
          keys={keys}
          onSubmit={(key, body) => run(`/accounts/${id}/overrides/${key}`, 'PUT', body)}
        />
      </Section>

      <Section title={d.usage}>
        <p className="text-sm">
          {fmt(d.estimate, { total: fmtMoney(data.month.estimate.total) })} ·{' '}
          <HeadCounts counts={data.month.headsNow} />
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ConfirmButton icon={RefreshCw} onConfirm={() => run(`/accounts/${id}/recount`, 'POST')}>
            {d.recount}
          </ConfirmButton>
          <span className="text-ink-subtle">{d.recountHint}</span>
        </div>
        <ul className="space-y-1 text-xs">
          {data.month.days.map((day) => (
            <li key={day.day} className="flex items-center gap-2">
              <span className="w-20 shrink-0 font-mono text-ink-subtle">{day.day}</span>
              <span
                className="h-2 rounded-full bg-primary"
                style={{ width: `${(day.student * 40) / maxDay}%` }}
              />
              <HeadCounts
                counts={Object.fromEntries(HEADS.map((h) => [h, day[h]])) as Record<Head, number>}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={d.institutes}>
        <ul className="divide-y divide-line text-sm">
          {data.institutes.map((i) => (
            <li key={i.id} className="flex justify-between py-1.5">
              <span>{i.name}</span>
              <span className="text-ink-subtle">{i.slug}</span>
            </li>
          ))}
          {!data.institutes.length && <li className="text-ink-subtle">{d.none}</li>}
        </ul>
      </Section>

      <Section title={d.invoices}>
        {data.invoices.length ? (
          <ul className="divide-y divide-line text-sm">
            {data.invoices.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} run={run} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-subtle">{d.noInvoices}</p>
        )}
        {data.payments.length > 0 && (
          <>
            <h3 className="pt-2 text-sm font-medium">{d.payments}</h3>
            <Table head={[t.admin.invoices.number, d.amount, d.reference, t.admin.audit.when]}>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{p.number}</Td>
                  <Td num>{fmtMoney(p.amount)}</Td>
                  <Td>{p.reference}</Td>
                  <Td>{colomboDate(p.receivedAt)}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Section>

      <Section title={d.history}>
        <AuditRows events={data.audit} showAccount={false} />
      </Section>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="block text-xs text-ink-subtle">{label}</span>
      {children}
    </div>
  );
}

type Run = (path: string, method: string, body?: unknown) => Promise<boolean>;

function InvoiceRow({ invoice, run }: { invoice: Invoice; run: Run }) {
  const { t } = useI18n();
  const d = t.admin.detail;
  const due = fromCents(Math.max(0, cents(invoice.total) - cents(invoice.paid)));
  const [amount, setAmount] = useState(due);
  const [reference, setReference] = useState('');
  // One clientRef per attempt: a double click or retry records once.
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  async function pay(e: FormEvent) {
    e.preventDefault();
    const ok = await run(`/invoices/${invoice.id}/payments`, 'POST', {
      amount,
      reference,
      clientRef,
    });
    if (ok) setClientRef(crypto.randomUUID());
  }

  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono">{invoice.number}</span>
        <Badge status={invoice.status === 'open' ? 'issued' : invoice.status}>
          {t.admin.invoices.statuses[invoice.status]}
        </Badge>
        <span>
          LKR {fmtMoney(invoice.total)}
          {cents(invoice.paid) > 0 && ` (${t.admin.invoices.paid} ${fmtMoney(invoice.paid)})`}
        </span>
        <span className="text-ink-subtle">
          {t.admin.invoices.dueDate} {invoice.dueDate}
        </span>
      </div>
      {invoice.status === 'open' && (
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={pay} className="flex flex-wrap items-end gap-2">
            <input
              aria-label={d.amount}
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${input} w-28`}
            />
            <input
              aria-label={d.reference}
              placeholder={d.reference}
              required
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={`${input} w-44`}
            />
            <Button full={false} size="sm">
              {d.recordPayment}
            </Button>
          </form>
          {cents(invoice.paid) === 0 && (
            <ReasonForm
              label={d.reason}
              action={d.void}
              icon={Ban}
              onSubmit={(reason) => run(`/invoices/${invoice.id}/void`, 'POST', { reason })}
            />
          )}
        </div>
      )}
    </li>
  );
}

function TrialForm({ onSubmit }: { onSubmit: (days: number) => Promise<boolean> }) {
  const { t } = useI18n();
  const [days, setDays] = useState('14');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Number(days));
      }}
      className="flex items-end gap-2"
    >
      <input
        aria-label={t.admin.detail.days}
        type="number"
        min={1}
        max={365}
        required
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className={`${input} w-24`}
      />
      <Button full={false} size="sm" variant="secondary" icon={CalendarPlus}>
        {t.admin.detail.extendTrial}
      </Button>
    </form>
  );
}

/** A reason box plus a two-tap button, for hard-to-undo actions (suspend, void). */
function ReasonForm({
  label,
  action,
  icon,
  onSubmit,
}: {
  label: string;
  action: string;
  icon: typeof Ban;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={label}
        placeholder={label}
        maxLength={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={`${input} w-48`}
      />
      {reason.trim() && (
        <ConfirmButton icon={icon} onConfirm={() => onSubmit(reason.trim())}>
          {action}
        </ConfirmButton>
      )}
    </div>
  );
}

function AccountForm({
  account,
  books,
  onSubmit,
}: {
  account: Detail['account'];
  books: PriceBook[];
  onSubmit: (patch: object) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const d = t.admin.detail;
  const [form, setForm] = useState({
    name: account.name,
    notes: account.notes ?? '',
    priceBook: account.priceBook,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: form.name, notes: form.notes.trim() || null, priceBook: form.priceBook });
      }}
      className="max-w-lg space-y-3"
    >
      <Field
        label={d.name}
        required
        maxLength={200}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <label className="block text-sm font-medium text-ink-muted">
        {d.priceBook}
        <select
          value={form.priceBook}
          onChange={(e) => setForm({ ...form, priceBook: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink"
        >
          {books.map((b) => (
            <option key={b.key} value={b.key}>
              {b.name} ({b.key})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-ink-muted">
        {d.notes}
        <textarea
          rows={3}
          maxLength={5000}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink"
        />
      </label>
      <Button full={false}>{d.save}</Button>
    </form>
  );
}

function OverrideForm({
  keys,
  onSubmit,
}: {
  keys: string[];
  onSubmit: (key: string, body: object) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const d = t.admin.detail;
  const [key, setKey] = useState('price.student');
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const kind = keyKind(key);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit(key, {
      value: parseValue(key, value),
      // End of that Sri Lanka day.
      expiresAt: expires ? `${expires}T23:59:59+05:30` : null,
      note,
    });
    if (ok) {
      setValue('');
      setNote('');
      setExpires('');
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <select
        aria-label={d.key}
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setValue(keyKind(e.target.value) === 'feature' ? 'true' : '');
        }}
        className={input}
      >
        {keys.map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      {kind === 'feature' ? (
        <select
          aria-label={d.value}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={input}
        >
          <option value="true">{d.on}</option>
          <option value="false">{d.off}</option>
        </select>
      ) : (
        <input
          aria-label={d.value}
          placeholder={kind === 'cap' ? d.unlimited : d.value}
          inputMode="decimal"
          required={kind !== 'cap'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${input} w-28`}
        />
      )}
      <label className="text-xs text-ink-muted">
        {d.expires}
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className={`${input} block`}
        />
      </label>
      <input
        aria-label={d.note}
        placeholder={d.note}
        required
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={`${input} w-56`}
      />
      <Button full={false} size="sm">
        {d.setOverride}
      </Button>
    </form>
  );
}
