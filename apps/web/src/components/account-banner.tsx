'use client';

import { CircleAlert, Clock, Lock } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/lib/api';
import { fmtMoney } from '@/lib/money';
import { useTenantData } from './dashboard-shell';

const TONE = {
  trial: 'bg-primary-soft text-primary-hover',
  overdue: 'bg-warning-soft text-warning',
  restricted: 'bg-danger-soft text-danger',
  suspended: 'bg-danger-soft text-danger',
};

/**
 * Account state above every page (SAAS_PLAN §5.2). Staff see trial, overdue, restricted and
 * suspended; parents and students only suspended, the one state that changes what they can do.
 */
export function AccountBanner() {
  const { lang, t } = useI18n();
  const b = t.billing.banner;
  const { tenant, roles, entitlements: e } = useTenantData();
  const staff = roles.some((r) => r !== 'student' && r !== 'parent');
  const manager = roles.some((r) => r === 'owner' || r === 'admin');
  if (e.state === 'active' || (!staff && e.state !== 'suspended')) return null;

  const amount = fmtMoney(e.amountDue);
  const text =
    e.state === 'trial'
      ? fmt(b.trial, { days: e.daysLeft ?? 0 })
      : e.state === 'overdue'
        ? fmt(b.overdue, { amount, number: e.overdueInvoice ?? '', date: e.overdueDueDate ?? '' })
        : e.state === 'restricted'
          ? fmt(b.restricted, { amount })
          : staff
            ? b.suspended
            : b.suspendedFamily;
  const Icon = e.state === 'trial' ? Clock : e.state === 'suspended' ? Lock : CircleAlert;

  return (
    <div
      role={e.state === 'trial' ? 'status' : 'alert'}
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm sm:mb-6 print:hidden ${TONE[e.state]}`}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {manager && e.state !== 'suspended' && (
        <Link
          href={`/${lang}/t/${tenant.id}/billing`}
          className="font-medium underline underline-offset-2"
        >
          {b.action}
        </Link>
      )}
    </div>
  );
}
