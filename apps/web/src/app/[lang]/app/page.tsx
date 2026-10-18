'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, type Me } from '@/lib/api';
import { LAST_TENANT_KEY } from '@/components/dashboard-shell';

/** Entry after login: go to the last-used institute, the only one, or create one. */
export default function AppEntry() {
  const { lang, t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    api<Me>('/auth/me')
      .then(({ user, tenants }) => {
        // Users from before email login add one first (EMAIL_AUTH_PLAN §9).
        if (!user.emailVerified) return router.replace(`/${lang}/account/email`);
        if (tenants.length === 0) return router.replace(`/${lang}/onboarding`);
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_TENANT_KEY);
        } catch {}
        const target = tenants.find((x) => x.id === last) ?? tenants[0]!;
        router.replace(`/${lang}/t/${target.id}`);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace(`/${lang}/login`);
      });
  }, [lang, router]);

  return <Spinner label={t.loading} />;
}
