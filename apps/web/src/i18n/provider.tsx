'use client';

import { createContext, use, type ReactNode } from 'react';
import type { Locale } from './config';
import type { Dictionary } from './dictionaries/en';

const I18nContext = createContext<{ lang: Locale; t: Dictionary } | null>(null);

export function I18nProvider({
  lang,
  dict,
  children,
}: {
  lang: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  return <I18nContext value={{ lang, t: dict }}>{children}</I18nContext>;
}

export function useI18n() {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
