'use client';

import { useTenantData } from './dashboard-shell';
import { useI18n } from '@/i18n/provider';

export function Overview() {
  const { t } = useI18n();
  const { me, tenant, roles } = useTenantData();

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">
        {t.dashboard.welcome.replace('{name}', me.user.fullName)}
      </h1>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <dt className="text-sm text-zinc-500">{t.dashboard.institute}</dt>
          <dd className="mt-1 font-medium">{tenant.name}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <dt className="text-sm text-zinc-500">{t.dashboard.yourRole}</dt>
          <dd className="mt-1 font-medium">{roles.map((r) => t.roles[r]).join(', ')}</dd>
        </div>
      </dl>
      <p className="text-zinc-600">{t.dashboard.comingNext}</p>
    </div>
  );
}
