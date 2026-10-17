'use client';

import { Mail, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage, fmt, type Me } from '@/lib/api';
import { CodeField } from './auth-form';
import { Brand, Button, Card, Field, FormError, Spinner } from './ui';

/** Change the login email: password + a code sent to the new address. */
export function EmailSettings() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace(`/${lang}/login`);
      });
  }, [lang, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      if (!sentTo) {
        await api('/auth/email/change', { method: 'POST', body: form });
        setSentTo(form.email!.trim().toLowerCase());
      } else {
        await api('/auth/email/confirm', { method: 'POST', body: { ...form, email: sentTo } });
        router.replace(`/${lang}/app`);
        return;
      }
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  if (!me) return <Spinner label={t.loading} />;
  return (
    <Card>
      <div className="mb-5">
        <Brand />
      </div>
      <h1 className="mb-2 text-xl font-semibold">{t.auth.changeEmailTitle}</h1>
      <p className="mb-6 text-sm text-ink-muted">
        {sentTo
          ? fmt(t.auth.codeSent, { email: sentTo })
          : fmt(t.auth.currentEmail, { email: me.user.email })}
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {sentTo ? (
          <CodeField label={t.auth.code} />
        ) : (
          <>
            <Field label={t.auth.email} name="email" type="email" required autoComplete="email" />
            <Field
              label={t.auth.password}
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </>
        )}
        <FormError message={error} />
        <Button type="submit" busy={busy} icon={sentTo ? MailCheck : Mail}>
          {sentTo ? t.auth.confirmButton : t.auth.sendCode}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link
          href={`/${lang}/app`}
          className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
        >
          {t.auth.back}
        </Link>
      </p>
    </Card>
  );
}
