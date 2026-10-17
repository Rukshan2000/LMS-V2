'use client';

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import type { Feature } from '@/lib/entitlements';
import { useTenantData } from './dashboard-shell';
import { card } from './ui';

/** Renders `children` when the account's plan includes `feature`, otherwise a card saying why not. */
export function Locked({ feature, children }: { feature: Feature; children?: ReactNode }) {
  const { t } = useI18n();
  const { entitlements } = useTenantData();
  if (entitlements.features[feature]) return children;
  return (
    <section className={`${card} mx-auto max-w-lg space-y-2 p-6 text-center text-sm`}>
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-neutral-soft text-ink-subtle">
        <Lock aria-hidden className="size-5" />
      </span>
      <h2 className="text-base font-medium">{t.locked.features[feature]}</h2>
      <p className="text-ink-muted">{t.locked.body}</p>
    </section>
  );
}
