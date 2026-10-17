'use client';

import { Building2, ChevronRight, Lock, UserRound } from 'lucide-react';
import Link from 'next/link';
import { NAV_ICONS, useTenantData } from './dashboard-shell';
import { useI18n } from '@/i18n/provider';
import { navForRoles } from '@/lib/nav';
import { Portal } from './portal';
import { card } from './ui';

export function Overview() {
  const { lang, t } = useI18n();
  const { me, tenant, roles, entitlements } = useTenantData();
  const family = roles.every((r) => r === 'student' || r === 'parent');
  const base = `/${lang}/t/${tenant.id}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {t.dashboard.welcome.replace('{name}', me.user.fullName)}
      </h1>
      {family ? (
        <Portal />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: Building2, label: t.dashboard.institute, value: tenant.name },
              {
                icon: UserRound,
                label: t.dashboard.yourRole,
                value: roles.map((r) => t.roles[r]).join(', '),
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className={`${card} flex items-center gap-3 p-4`}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <dt className="text-sm text-ink-subtle">{label}</dt>
                  <dd className="truncate font-medium">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
          <p className="text-ink-muted">{t.dashboard.comingNext}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {navForRoles(roles)
              .filter((item) => item.path)
              .map((item) => {
                const Icon = NAV_ICONS[item.key];
                return (
                  <li key={item.key}>
                    <Link
                      href={`${base}${item.path}`}
                      className={`${card} group flex items-center gap-3 p-4 font-medium transition duration-200 hover:-translate-y-px hover:border-primary-ring hover:shadow-raised`}
                    >
                      <Icon aria-hidden className="size-5 text-primary" />
                      <span className="flex-1">{t.nav[item.key]}</span>
                      {item.feature && !entitlements.features[item.feature] && (
                        <Lock
                          role="img"
                          aria-label={t.locked.label}
                          className="size-4 text-ink-subtle"
                        />
                      )}
                      <ChevronRight
                        aria-hidden
                        className="size-4 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </div>
  );
}
