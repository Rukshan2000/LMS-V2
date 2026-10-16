'use client';

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
    <select
      aria-label={t.dashboard.language}
      value={lang}
      onChange={(e) => change(e.target.value as Locale)}
      className={`rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm ${className}`}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}
