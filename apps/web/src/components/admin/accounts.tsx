'use client';

import { MessageCircle, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { fmtMoney } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { displayPhone } from '../students/types';
import { btn, Button, EmptyState, Field, FormError, FormSuccess, Skeleton } from '../ui';
import {
  HeadCounts,
  StateBadge,
  Table,
  Td,
  type AccountSummary,
  type Head,
  type PriceBook,
} from './shared';

type Row = AccountSummary & {
  institutes: number;
  headsNow: Record<Head, number>;
  estimate: string;
};
const FILTERS = ['all', 'trial_ending', 'overdue', 'restricted', 'suspended'] as const;

/** WhatsApp reminder for the row: amount due if any, else the trial ending. Console language. */
function reminder(a: Row, t: ReturnType<typeof useI18n>['t']) {
  const name = a.ownerName ?? a.name;
  if (Number(a.amountDue) > 0) {
    return fmt(t.admin.accounts.reminderDue, {
      name,
      number: a.overdueInvoice ?? '',
      amount: fmtMoney(a.amountDue),
    });
  }
  if (a.state === 'trial') {
    return fmt(t.admin.accounts.reminderTrial, { name, days: a.daysLeft ?? 0 });
  }
  return null;
}

export function AccountsList() {
  const { lang, t } = useI18n();
  const a = t.admin.accounts;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (filter !== 'all') params.set('state', filter);
    const timer = setTimeout(() => {
      api<{ accounts: Row[] }>(`/admin/accounts?${params}`)
        .then((r) => setRows(r.accounts))
        .catch((err) => setError(errorMessage(t, err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, filter, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <Link href={`/${lang}/admin/accounts/new`} className={`${btn()} ml-auto`}>
          <Plus aria-hidden className="size-4" />
          {a.new}
        </Link>
      </div>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-60 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3">
          <Search aria-hidden className="size-4 text-ink-subtle" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={a.search}
            aria-label={a.search}
            className="w-full border-0 bg-transparent py-2 focus:shadow-none"
          />
        </label>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={btn(filter === f ? 'primary' : 'secondary', 'sm')}
          >
            {t.admin.filters[f]}
          </button>
        ))}
      </div>
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search}>{a.empty}</EmptyState>
      ) : (
        <Table head={[a.account, a.owner, a.state, a.headsNow, a.estimate, a.due, '']}>
          {rows.map((r) => {
            const text = reminder(r, t);
            return (
              <tr key={r.id}>
                <Td>
                  <Link
                    href={`/${lang}/admin/accounts/${r.id}`}
                    className="font-medium text-primary hover:text-primary-hover"
                  >
                    {r.name}
                  </Link>
                  <span className="block text-xs text-ink-subtle">
                    {r.priceBook} · {r.institutes} {t.admin.detail.institutes.toLowerCase()}
                  </span>
                </Td>
                <Td>
                  {r.ownerName ?? <span className="text-ink-subtle">{a.unclaimed}</span>}
                  <span className="block text-xs text-ink-subtle">
                    {r.ownerEmail ?? displayPhone(r.ownerPhone)}
                  </span>
                </Td>
                <Td>
                  <StateBadge state={r.state} />
                  {r.state === 'trial' && (
                    <span className="block text-xs text-ink-subtle">
                      {fmt(a.daysLeft, { days: r.daysLeft ?? 0 })}
                    </span>
                  )}
                </Td>
                <Td>
                  <HeadCounts counts={r.headsNow} />
                </Td>
                <Td num>{fmtMoney(r.estimate)}</Td>
                <Td num>{Number(r.amountDue) > 0 ? fmtMoney(r.amountDue) : '–'}</Td>
                <Td>
                  {text && r.ownerPhone && (
                    <a
                      href={waLink(r.ownerPhone, text)}
                      target="_blank"
                      rel="noreferrer"
                      className={btn('whatsapp', 'xs')}
                    >
                      <MessageCircle aria-hidden className="size-3.5" />
                      {a.remind}
                    </a>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

export function NewAccount() {
  const { lang, t } = useI18n();
  const n = t.admin.newAccount;
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [form, setForm] = useState({
    name: '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    priceBook: '',
    trialDays: '30',
  });
  const [created, setCreated] = useState<{
    id: string;
    message: string;
    phone: string | null;
    emailSent: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ priceBooks: PriceBook[] }>('/admin/price-books'),
      api<{ settings: { trial_days: number } }>('/admin/settings'),
    ])
      .then(([b, s]) => {
        setBooks(b.priceBooks);
        setForm((f) => ({
          ...f,
          priceBook: b.priceBooks.find((x) => x.isDefault)?.key ?? b.priceBooks[0]?.key ?? '',
          trialDays: String(s.settings.trial_days),
        }));
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // ownerName is not sent: it only goes into the WhatsApp message (SAAS_PLAN §10.2).
      const res = await api<{
        account: { id: string; ownerEmail: string; ownerPhone: string | null };
        emailSent: boolean;
      }>('/admin/accounts', {
        method: 'POST',
        body: {
          name: form.name,
          ownerEmail: form.ownerEmail,
          ownerPhone: form.ownerPhone,
          priceBook: form.priceBook,
          trialDays: Number(form.trialDays),
        },
      });
      setCreated({
        id: res.account.id,
        phone: res.account.ownerPhone,
        emailSent: res.emailSent,
        message: fmt(n.message, {
          name: form.ownerName || form.name,
          account: form.name,
          email: res.account.ownerEmail,
          url: `${window.location.origin}/${lang}/signup?email=${encodeURIComponent(res.account.ownerEmail)}`,
        }),
      });
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">{n.title}</h1>
      {created ? (
        <div className="space-y-3">
          {created.emailSent ? (
            <FormSuccess>{n.created}</FormSuccess>
          ) : (
            <FormError message={n.createdNoEmail} />
          )}
          <a
            href={waLink(created.phone, created.message)}
            target="_blank"
            rel="noreferrer"
            className={btn('whatsapp', 'md', true)}
          >
            <MessageCircle aria-hidden className="size-4" />
            {n.send}
          </a>
          <Link
            href={`/${lang}/admin/accounts/${created.id}`}
            className={btn('secondary', 'md', true)}
          >
            {n.open}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <FormError message={error} />
          <Field label={n.name} required maxLength={200} value={form.name} onChange={set('name')} />
          <Field
            label={n.ownerName}
            hint={n.ownerNameHint}
            maxLength={200}
            value={form.ownerName}
            onChange={set('ownerName')}
          />
          <Field
            label={n.ownerEmail}
            required
            type="email"
            maxLength={254}
            value={form.ownerEmail}
            onChange={set('ownerEmail')}
          />
          <Field
            label={n.ownerPhone}
            type="tel"
            inputMode="tel"
            value={form.ownerPhone}
            onChange={set('ownerPhone')}
          />
          <label className="block text-sm font-medium text-ink-muted">
            {n.priceBook}
            <select
              value={form.priceBook}
              onChange={set('priceBook')}
              className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink"
            >
              {books.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.name} ({b.key})
                </option>
              ))}
            </select>
          </label>
          <Field
            label={n.trialDays}
            required
            type="number"
            min={0}
            max={365}
            value={form.trialDays}
            onChange={set('trialDays')}
          />
          <Button busy={busy}>{n.create}</Button>
        </form>
      )}
    </div>
  );
}
