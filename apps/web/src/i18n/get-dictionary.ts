import 'server-only';
import type { Locale } from './config';

const dictionaries = {
  en: () => import('./dictionaries/en').then((m) => m.default),
  si: () => import('./dictionaries/si').then((m) => m.default),
  ta: () => import('./dictionaries/ta').then((m) => m.default),
};

export const getDictionary = (locale: Locale) => dictionaries[locale]();
