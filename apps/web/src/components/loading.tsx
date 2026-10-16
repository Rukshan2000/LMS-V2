'use client';

import { useI18n } from '@/i18n/provider';
import { Spinner } from './ui';

export function Loading() {
  return <Spinner label={useI18n().t.loading} />;
}
