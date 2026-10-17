'use client';

import { CreditCard, Landmark, MessageCircle, ReceiptText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import type { Billing, Cap } from '@/lib/entitlements';
import { cents, fmtMoney, fromCents } from '@/lib/money';
import { waLink } from '@/lib/whatsapp';
import { HEADS, StateBadge, Table, Td } from '../admin/shared';
import { useTenantData } from '../dashboard-shell';
import { Badge, card, FormError, Skeleton, btn } from '../ui';

const CAPS: Cap[] = ['students', 'teachers', 'parents', 'institutes'];
const dueOf = (i: Billing['invoices'][number]) =>
  fromCents(Math.max(0, cents(i.total) - cents(i.paid)));

/** Owner/admin: this month so far, invoices and how to pay (SAAS_PLAN §6.4). */
export function BillingPage() {
  const { t } = useI18n();
  const b = t.billing;
  const { tenant, entitlements: e } = useTenantData();
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Billing>(`/tenants/${tenant.id}/billing`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenant.id, t]);

  const caps = CAPS.filter((c) => e.caps[c].limit !== null);
  const section = `${card} space-y-3 p-4 text-sm`;
  const heading = 'flex flex-wrap items-center gap-2 text-base font-medium';

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
        {b.title}
        <StateBadge state={e.state} />
      </h1>
      <FormError message={error} />

      {(e.state === 'trial' || caps.length > 0) && (
        <section className={section}>
          {e.state === 'trial' && (
            <p className="font-medium">{fmt(b.trial, { days: e.daysLeft ?? 0 })}</p>
          )}
          {caps.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {caps.map((c) => {
                const { limit, used = 0 } = e.caps[c];
                // Amber, not red: being at a limit is normal (a trial has 1 institute of 1).
                const full = used >= limit!;
                return (
                  <li key={c} className="space-y-1">
                    <span className="flex justify-between gap-2">
                      {b.caps[c]}
                      <span className={`font-mono ${full ? 'font-semibold text-warning' : ''}`}>
                        {used} / {limit}
                      </span>
                    </span>
                    <span className="block h-2 overflow-hidden rounded-full bg-surface-soft">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, (used * 100) / Math.max(limit!, 1))}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {!data && !error && <Skeleton />}
      {data && (
        <>
          <section className={section}>
            <h2 className={heading}>
              <CreditCard aria-hidden className="size-5 text-primary" />
              {fmt(b.thisMonth, { month: data.thisMonth.period })}
            </h2>
            <p className="text-ink-subtle">{b.thisMonthHint}</p>
            {data.thisMonth.lines.length === 0 ? (
              <p>{e.state === 'trial' ? b.nothingTrial : b.nothing}</p>
            ) : (
              <Table head={[b.item, b.peak, b.unitPrice, b.amount]}>
                {data.thisMonth.lines.map((l) =>
                  l.type === 'head' ? (
                    <tr key={l.head}>
                      <Td>
                        {t.admin.heads[l.head]}
                        {l.included > 0 && (
                          <span className="block text-ink-subtle">
                            {fmt(b.included, { count: l.included })}
                          </span>
                        )}
                      </Td>
                      <Td num>{l.peak}</Td>
                      <Td num>{fmtMoney(l.unitPrice)}</Td>
                      <Td num>{fmtMoney(l.amount)}</Td>
                    </tr>
                  ) : (
                    <tr key="minimum">
                      <Td>{fmt(b.minimum, { amount: fmtMoney(l.minimum) })}</Td>
                      <Td num>{''}</Td>
                      <Td num>{''}</Td>
                      <Td num>{fmtMoney(l.amount)}</Td>
                    </tr>
                  ),
                )}
                <tr className="font-medium">
                  <Td>{b.total}</Td>
                  <Td num>{''}</Td>
                  <Td num>{''}</Td>
                  <Td num>{fmtMoney(data.thisMonth.total)}</Td>
                </tr>
              </Table>
            )}
            <p className="text-ink-subtle">
              {b.prices}{' '}
              {HEADS.filter((h) => cents(data.prices[h]) > 0)
                .map((h) => `${t.admin.heads[h]} LKR ${fmtMoney(data.prices[h])}`)
                .join(' · ')}
            </p>
          </section>

          <section className={section}>
            <h2 className={heading}>
              <ReceiptText aria-hidden className="size-5 text-primary" />
              {b.invoices}
            </h2>
            {data.invoices.length === 0 ? (
              <p className="text-ink-subtle">{b.noInvoices}</p>
            ) : (
              <Table head={[b.number, b.month, b.amount, b.due, b.status]}>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <span className="font-mono whitespace-nowrap">{i.number}</span>
                    </Td>
                    <Td>{i.period}</Td>
                    <Td num>
                      {fmtMoney(i.total)}
                      {i.status === 'open' && cents(i.paid) > 0 && (
                        <span className="block text-ink-subtle">
                          {fmt(b.left, { amount: fmtMoney(dueOf(i)) })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">{i.dueDate}</span>
                    </Td>
                    <Td>
                      <Badge tone={i.status === 'paid' ? 'success' : 'warning'}>
                        {b.statuses[i.status]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {/* Outside the table, so the button never scrolls off a phone screen. */}
            {data.payTo.whatsapp &&
              data.invoices
                .filter((i) => i.status === 'open')
                .map((i) => (
                  <a
                    key={i.id}
                    href={waLink(
                      data.payTo.whatsapp!,
                      fmt(b.slipMessage, {
                        number: i.number,
                        amount: fmtMoney(dueOf(i)),
                        institute: tenant.name,
                      }),
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className={`${btn('whatsapp')} w-full sm:w-auto`}
                  >
                    <MessageCircle aria-hidden className="size-4" />
                    {b.sendSlip}
                    <span className="font-mono">
                      {i.number} · LKR {fmtMoney(dueOf(i))}
                    </span>
                  </a>
                ))}
          </section>

          <section className={section}>
            <h2 className={heading}>
              <Landmark aria-hidden className="size-5 text-primary" />
              {b.howToPay}
            </h2>
            {data.payTo.bankDetails ? (
              <p className="rounded-lg bg-surface-soft p-3 font-mono whitespace-pre-line">
                {data.payTo.bankDetails}
              </p>
            ) : (
              <p className="text-ink-subtle">{b.noBankDetails}</p>
            )}
            <p>{b.reference}</p>
            {data.payTo.whatsapp && <p>{fmt(b.whatsapp, { phone: `+${data.payTo.whatsapp}` })}</p>}
          </section>
        </>
      )}
    </div>
  );
}
