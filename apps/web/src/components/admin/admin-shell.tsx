'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, type User } from '@/lib/api';
import { LanguageSwitcher } from '../language-switcher';
import { Spinner, ToastProvider } from '../ui';

const NAV = [
  ['accounts', ''],
  ['invoices', '/invoices'],
  ['priceBooks', '/price-books'],
  ['settings', '/settings'],
  ['audit', '/audit'],
  ['docs', '/docs'],
] as const;

/**
 * Platform console frame. The console has its own login (/admin/login, console cookie); without
 * a console session, or with one older than 12 hours, you are sent there.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const pathname = usePathname();
  // The login page is outside the frame.
  if (pathname === `/${lang}/admin/login`) return children;
  return <Frame>{children}</Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<User | null>(null);
  const [reauth, setReauth] = useState(false);

  useEffect(() => {
    api<{ user: User }>('/admin/auth/me')
      .then((res) => setMe(res.user))
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'reauth_required') setReauth(true);
        else router.replace(`/${lang}/admin/login`);
      });
  }, [lang, router]);

  async function logout() {
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace(`/${lang}/admin/login`);
  }

  const base = `/${lang}/admin`;
  const isActive = (path: string) =>
    path === ''
      ? pathname === base || pathname.startsWith(`${base}/accounts`)
      : pathname.startsWith(`${base}${path}`);

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <div className="flex items-center gap-2 bg-ink px-4 py-1.5 text-sm text-white print:hidden">
          <ShieldCheck aria-hidden className="size-4 text-accent-sky" />
          <span className="font-medium">{t.admin.bar}</span>
          {me && <span className="text-white/70 max-sm:hidden">· {me.fullName}</span>}
          <button
            type="button"
            onClick={logout}
            className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <LogOut aria-hidden className="size-4" />
            <span className="max-sm:sr-only">{t.dashboard.logout}</span>
          </button>
        </div>
        <header className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-4 py-2 print:hidden">
          <nav className="flex flex-wrap gap-1">
            {NAV.map(([key, path]) => (
              <Link
                key={key}
                href={`${base}${path}`}
                aria-current={isActive(path) ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive(path)
                    ? 'bg-primary-soft text-primary-hover'
                    : 'text-ink-muted hover:bg-surface-soft hover:text-ink'
                }`}
              >
                {t.admin.nav[key]}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher className="ml-auto" />
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-8">
          {reauth ? (
            <p className="max-w-md space-y-3 text-sm">
              <span className="block">{t.admin.reauth}</span>
              <button
                type="button"
                onClick={logout}
                className="font-medium text-primary hover:text-primary-hover"
              >
                {t.auth.loginButton}
              </button>
            </p>
          ) : me ? (
            <div key={pathname} className="animate-fade-in">
              {children}
            </div>
          ) : (
            <Spinner label={t.loading} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
