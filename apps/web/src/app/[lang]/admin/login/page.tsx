'use client';

import { LogIn, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button, Card, Field, FormError } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';

// Platform console login: separate from the institute login, platform owner only.
export default function Page() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/admin/auth/login', {
        method: 'POST',
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      router.replace(`/${lang}/admin`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-ink px-4 py-10">
      <Card>
        <h1 className="mb-2 flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck aria-hidden className="size-5 text-primary" />
          {t.admin.loginTitle}
        </h1>
        <p className="mb-6 text-sm text-ink-muted">{t.admin.loginHint}</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t.auth.email} name="email" type="email" required autoComplete="username" />
          <Field
            label={t.auth.password}
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <FormError message={error} />
          <Button type="submit" busy={busy} icon={LogIn}>
            {t.auth.loginButton}
          </Button>
        </form>
      </Card>
      <LanguageSwitcher />
    </main>
  );
}
