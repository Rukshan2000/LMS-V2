'use client';

import { ChevronRight, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { useTenantData } from '../dashboard-shell';
import { card } from '../ui';

/** Settings: the plan moved to its own Billing page. */
export function BillingLink() {
  const { lang, t } = useI18n();
  const { tenant } = useTenantData();
  return (
    <Link
      href={`/${lang}/t/${tenant.id}/billing`}
      className={`${card} flex items-center gap-3 p-4 text-sm transition-colors hover:bg-surface-soft`}
    >
      <CreditCard aria-hidden className="size-5 shrink-0 text-primary" />
      <span className="flex-1">
        <span className="block text-base font-medium">{t.nav.billing}</span>
        <span className="text-ink-subtle">{t.billing.settingsLink}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 text-ink-subtle" />
    </Link>
  );
}
