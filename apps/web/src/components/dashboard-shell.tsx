'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, type Me, type Role } from '@/lib/api';
import { navForRoles } from '@/lib/nav';
import { LanguageSwitcher } from './language-switcher';
import { Spinner } from './ui';

export const LAST_TENANT_KEY = 'lastTenantId';

interface TenantData {
  me: Me;
  tenant: { id: string; slug: string; name: string; status: string; plan: string };
  roles: Role[];
}

const TenantDataContext = createContext<TenantData | null>(null);

export function useTenantData() {
  const ctx = use(TenantDataContext);
  if (!ctx) throw new Error('useTenantData outside DashboardShell');
  return ctx;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { lang, t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<TenantData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Me>('/auth/me'), api<Omit<TenantData, 'me'>>(`/tenants/${tenantId}`)])
      .then(([me, tenantRes]) => {
        if (cancelled) return;
        setData({ me, ...tenantRes });
        try {
          localStorage.setItem(LAST_TENANT_KEY, tenantId);
        } catch {}
      })
      .catch((err) => {
        if (!(err instanceof ApiError)) return;
        if (err.status === 401) router.replace(`/${lang}/login`);
        else if (err.status === 404) router.replace(`/${lang}/app`);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, lang, router]);

  if (!data) return <Spinner label={t.loading} />;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace(`/${lang}/login`);
  }

  const base = `/${lang}/t/${tenantId}`;
  // Overview ('') only on exact match; other sections also for their sub-pages.
  const isActive = (path: string) =>
    path === ''
      ? pathname === base
      : pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`);
  const sidebar = (
    <nav className="flex flex-col gap-1 p-3">
      {navForRoles(data.roles).map((item) =>
        item.path !== undefined ? (
          <Link
            key={item.key}
            href={`${base}${item.path}`}
            onClick={() => setMenuOpen(false)}
            aria-current={isActive(item.path) ? 'page' : undefined}
            className={`rounded-lg px-3 py-2 font-medium ${
              isActive(item.path)
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {t.nav[item.key]}
          </Link>
        ) : (
          <span
            key={item.key}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-zinc-400"
          >
            {t.nav[item.key]}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{t.dashboard.soon}</span>
          </span>
        ),
      )}
    </nav>
  );

  return (
    <TenantDataContext value={data}>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 print:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm md:hidden"
          >
            {t.dashboard.menu}
          </button>
          <select
            aria-label={t.dashboard.switchInstitute}
            value={tenantId}
            onChange={(e) => {
              if (e.target.value === 'new') router.push(`/${lang}/onboarding`);
              else router.push(`/${lang}/t/${e.target.value}`);
            }}
            className="min-w-0 max-w-[50vw] truncate rounded-md border border-zinc-300 bg-white px-2 py-1 font-medium"
          >
            {data.me.tenants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value="new">{t.dashboard.newInstitute}</option>
          </select>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher className="hidden sm:block" />
            <span className="hidden text-sm text-zinc-600 sm:inline">{data.me.user.fullName}</span>
            <button type="button" onClick={logout} className="text-sm text-zinc-600 underline">
              {t.dashboard.logout}
            </button>
          </div>
        </header>
        <div className="flex flex-1">
          <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white md:block print:hidden">
            {sidebar}
          </aside>
          {menuOpen && (
            <div className="fixed inset-x-0 top-[57px] bottom-0 z-10 bg-white md:hidden">
              {sidebar}
              <div className="px-6">
                <LanguageSwitcher />
              </div>
            </div>
          )}
          <main className="min-w-0 flex-1 p-4 sm:p-8 print:p-0">{children}</main>
        </div>
      </div>
    </TenantDataContext>
  );
}
