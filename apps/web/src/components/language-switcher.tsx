'use client';

import { Languages } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { LOCALE_COOKIE, localeNames, locales, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  function change(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.push(pathname.replace(/^\/(si|ta|en)(?=\/|$)/, `/${next}`));
  }

  return (
    <label
      className={`flex w-fit items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-sm transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-ring hover:border-line-strong ${className}`}
    >
      <Languages aria-hidden className="size-4 text-ink-subtle" />
      <select
        aria-label={t.dashboard.language}
        value={lang}
        onChange={(e) => change(e.target.value as Locale)}
        className="border-0 bg-transparent py-1.5 focus:shadow-none"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {localeNames[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
