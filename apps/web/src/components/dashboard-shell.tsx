'use client';

import {
  BookOpen,
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  FileText,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScanLine,
  Settings,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from './logo';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, type Me, type Role } from '@/lib/api';
import type { Entitlements } from '@/lib/entitlements';
import { navForRoles, type NavItem } from '@/lib/nav';
import { AccountBanner } from './account-banner';
import { LanguageSwitcher } from './language-switcher';
import { Skeleton, ToastProvider } from './ui';

export const LAST_TENANT_KEY = 'lastTenantId';
const SIDEBAR_KEY = 'sidebarCollapsed';

export const NAV_ICONS: Record<NavItem['key'], LucideIcon> = {
  overview: LayoutDashboard,
  scan: ScanLine,
  students: Users,
  classes: BookOpen,
  attendance: ClipboardCheck,
  fees: Wallet,
  slips: Receipt,
  timetable: CalendarDays,
  quizzes: ListChecks,
  tutes: FileText,
  reports: ChartColumn,
  billing: CreditCard,
  settings: Settings,
};

interface TenantData {
  me: Me;
  tenant: { id: string; slug: string; name: string; status: string; theme: string };
  roles: Role[];
  entitlements: Entitlements;
}

interface TenantContext extends TenantData {
  /** Apply a saved change to the institute (e.g. its theme) without reloading. */
  updateTenant: (patch: Partial<TenantData['tenant']>) => void;
}

const TenantDataContext = createContext<TenantContext | null>(null);

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
  // Desktop only: icon rail instead of the full menu. Remembered in this browser.
  const [collapsed, setCollapsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const context = useMemo(
    () =>
      data && {
        ...data,
        updateTenant: (patch: Partial<TenantData['tenant']>) =>
          setData((d) => d && { ...d, tenant: { ...d.tenant, ...patch } }),
      },
    [data],
  );

  // The institute's colour, on <html> so the page background and toasts follow it too.
  const theme = data?.tenant.theme;
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Me>('/auth/me'), api<Omit<TenantData, 'me'>>(`/tenants/${tenantId}`)])
      .then(([me, tenantRes]) => {
        if (cancelled) return;
        if (!me.user.emailVerified) return router.replace(`/${lang}/account/email`);
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

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
  const navItem =
    'flex items-center gap-3 rounded-lg px-3 py-2 font-medium whitespace-nowrap transition-colors duration-200';
  // `compact`: icons only, the label becomes a tooltip and stays readable by screen readers.
  const nav = (compact: boolean) =>
    data ? (
      <nav className="flex flex-col gap-1 p-3">
        {navForRoles(data.roles).map((item) => {
          const Icon = NAV_ICONS[item.key];
          if (item.path === undefined)
            return (
              <span
                key={item.key}
                title={compact ? t.nav[item.key] : undefined}
                className={`${navItem} text-ink-subtle`}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className={compact ? 'sr-only' : 'flex-1'}>{t.nav[item.key]}</span>
                {!compact && (
                  <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs">
                    {t.dashboard.soon}
                  </span>
                )}
              </span>
            );
          const active = isActive(item.path);
          const locked = item.feature && !data.entitlements.features[item.feature];
          return (
            <Link
              key={item.key}
              href={`${base}${item.path}`}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? 'page' : undefined}
              title={compact ? t.nav[item.key] : undefined}
              className={`${navItem} relative ${
                active
                  ? 'bg-primary-soft text-primary-hover'
                  : 'text-ink-muted hover:bg-surface-soft hover:text-ink'
              }`}
            >
              <Icon
                aria-hidden
                className={`size-5 shrink-0 ${active ? 'text-primary' : 'text-ink-subtle'}`}
              />
              <span className={compact ? 'sr-only' : 'flex-1'}>{t.nav[item.key]}</span>
              {locked && (
                <Lock
                  role="img"
                  aria-label={t.locked.label}
                  className={`size-3.5 shrink-0 text-ink-subtle ${compact ? 'absolute right-1.5 top-1.5' : ''}`}
                />
              )}
            </Link>
          );
        })}
      </nav>
    ) : (
      <div className="space-y-2 p-3" aria-hidden>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-9 animate-shimmer rounded-lg bg-surface-soft" />
        ))}
      </div>
    );

  return (
    <TenantDataContext value={context}>
      <ToastProvider>
        <div className="flex min-h-full flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur print:hidden">
            <button
              ref={menuButton}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={t.dashboard.menu}
              className="-ml-1 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-soft md:hidden"
            >
              {menuOpen ? (
                <X aria-hidden className="size-5" />
              ) : (
                <Menu aria-hidden className="size-5" />
              )}
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="sidebar"
              aria-label={t.dashboard.menu}
              title={t.dashboard.menu}
              className="-ml-1 hidden rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink md:flex"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-5" />
              ) : (
                <PanelLeftClose aria-hidden className="size-5" />
              )}
            </button>
            <Logo className="hidden size-8 md:block" />
            {data ? (
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-2 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-ring hover:border-line-strong">
                <Building2 aria-hidden className="size-4 shrink-0 text-ink-subtle" />
                <select
                  aria-label={t.dashboard.switchInstitute}
                  value={tenantId}
                  onChange={(e) => router.push(`/${lang}/t/${e.target.value}`)}
                  className="min-w-0 max-w-[45vw] truncate border-0 bg-transparent py-1.5 font-medium focus:shadow-none"
                >
                  {data.me.tenants.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="h-8 w-40 animate-shimmer rounded-lg bg-surface-soft" />
            )}
            <div className="ml-auto flex items-center gap-3">
              <LanguageSwitcher className="max-sm:hidden" />
              {data && (
                <Link
                  href={`/${lang}/account/email`}
                  title={`${t.auth.changeEmailTitle}: ${data.me.user.email ?? ''}`}
                  className="hidden items-center gap-2 rounded-lg px-1 text-sm text-ink-muted transition-colors hover:text-ink sm:flex"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-hover">
                    {data.me.user.fullName.trim().charAt(0).toUpperCase()}
                  </span>
                  {data.me.user.fullName}
                </Link>
              )}
              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink"
              >
                <LogOut aria-hidden className="size-4" />
                <span className="hidden sm:inline">{t.dashboard.logout}</span>
                <span className="sr-only sm:hidden">{t.dashboard.logout}</span>
              </button>
            </div>
          </header>
          <div className="flex flex-1">
            <aside
              id="sidebar"
              className={`hidden shrink-0 overflow-hidden border-r border-line bg-surface transition-[width] duration-200 ease-out md:block print:hidden ${collapsed ? 'w-[4.25rem]' : 'w-60'}`}
            >
              <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto">
                {nav(collapsed)}
              </div>
            </aside>
            {menuOpen && (
              <div
                id="mobile-menu"
                className="fixed inset-x-0 top-14 bottom-0 z-10 animate-slide-down overflow-y-auto bg-surface md:hidden"
              >
                {nav(false)}
                <div className="px-6 pb-6">
                  <LanguageSwitcher />
                </div>
              </div>
            )}
            <main className="min-w-0 flex-1 p-4 sm:p-8 print:p-0">
              {data ? (
                <div key={pathname} className="animate-fade-in">
                  <AccountBanner />
                  {children}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="h-8 w-48 animate-shimmer rounded-lg bg-line" />
                  <Skeleton />
                </div>
              )}
            </main>
          </div>
        </div>
      </ToastProvider>
    </TenantDataContext>
  );
}
