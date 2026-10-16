export const locales = ['si', 'ta', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'si';
export const LOCALE_COOKIE = 'locale';

export const localeNames: Record<Locale, string> = { si: 'සිංහල', ta: 'தமிழ்', en: 'English' };

export const isLocale = (value: string | undefined | null): value is Locale =>
  locales.includes(value as Locale);

/** Saved choice first, then the browser's languages in order, then Sinhala. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  for (const part of acceptLanguage?.split(',') ?? []) {
    const lang = part.split(';')[0]!.trim().slice(0, 2).toLowerCase();
    if (isLocale(lang)) return lang;
  }
  return defaultLocale;
}
