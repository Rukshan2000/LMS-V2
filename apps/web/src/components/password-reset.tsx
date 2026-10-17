'use client';

import { KeyRound, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { AuthForm, CodeField } from './auth-form';
import { Brand, Button, Card, Field, FormError } from './ui';

/** /signup?email=… from the "account ready" email: the email is filled in and locked. */
export function SignupPage() {
  const email = useSearchParams().get('email') || undefined;
  return <AuthForm mode="signup" email={email} />;
}

/** Forgot password: email → code + new password → logged in (other sessions are ended). */
export function PasswordReset() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }
  const send = (email: string) =>
    run(async () => {
      await api('/auth/password/forgot', { method: 'POST', body: { email } });
      setSentTo(email);
    });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!sentTo) return send(form.email!);
    return run(async () => {
      await api('/auth/password/reset', { method: 'POST', body: { ...form, email: sentTo } });
      router.replace(`/${lang}/app`);
    });
  }

  return (
    <Card>
      <div className="mb-5">
        <Brand />
      </div>
      <h1 className="mb-2 text-xl font-semibold">{t.auth.resetTitle}</h1>
      <p className="mb-6 text-sm text-ink-muted">
        {sentTo ? fmt(t.auth.codeSent, { email: sentTo }) : t.auth.resetIntro}
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {sentTo ? (
          <>
            <CodeField label={t.auth.code} />
            <Field
              label={t.auth.newPassword}
              name="password"
              type="password"
              required
              minLength={8}
              hint={t.auth.passwordHint}
              autoComplete="new-password"
            />
          </>
        ) : (
          <Field label={t.auth.email} name="email" type="email" required autoComplete="email" />
        )}
        <FormError message={error} />
        <Button type="submit" busy={busy} icon={sentTo ? KeyRound : Mail}>
          {sentTo ? t.auth.resetButton : t.auth.sendCode}
        </Button>
      </form>
      <p className="mt-6 flex justify-between text-sm">
        <Link
          href={`/${lang}/login`}
          className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
        >
          {t.auth.back}
        </Link>
        {sentTo && (
          <button
            type="button"
            onClick={() => send(sentTo)}
            className="font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
          >
            {t.auth.resendCode}
          </button>
        )}
      </p>
    </Card>
  );
}
