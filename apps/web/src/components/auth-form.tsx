'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, Field, FormError } from './ui';

export function AuthForm({
  mode,
  phone,
  fullName,
  onDone,
  onSwitch,
}: {
  mode: 'login' | 'signup';
  /** Prefill and lock the mobile number (invite links). */
  phone?: string;
  fullName?: string;
  /** Called after login/signup instead of going to the app. */
  onDone?: () => void;
  /** Switch login ↔ signup in place instead of navigating. */
  onSwitch?: () => void;
}) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: Object.fromEntries(form) });
      if (onDone) onDone();
      else router.replace(`/${lang}/app`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  const signup = mode === 'signup';
  return (
    <Card>
      <h1 className="mb-6 text-xl font-semibold">
        {signup ? t.auth.signupTitle : t.auth.loginTitle}
      </h1>
      <form onSubmit={onSubmit} className="space-y-4">
        {signup && (
          <Field
            label={t.auth.fullName}
            name="fullName"
            required
            autoComplete="name"
            defaultValue={fullName}
          />
        )}
        <Field
          label={t.auth.phone}
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="077 123 4567"
          required
          autoComplete="tel"
          defaultValue={phone}
          readOnly={phone !== undefined}
        />
        <Field
          label={t.auth.password}
          name="password"
          type="password"
          required
          minLength={signup ? 8 : undefined}
          hint={signup ? t.auth.passwordHint : undefined}
          autoComplete={signup ? 'new-password' : 'current-password'}
        />
        {signup && (
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="acceptPrivacy" required className="mt-1" />
            <span>
              {t.auth.acceptPrivacy}{' '}
              <Link
                href={`/${lang}/privacy`}
                target="_blank"
                className="font-medium text-indigo-600"
              >
                {t.privacy.title}
              </Link>
            </span>
          </label>
        )}
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          {signup ? t.auth.signupButton : t.auth.loginButton}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600">
        {signup ? t.auth.haveAccount : t.auth.noAccount}{' '}
        {onSwitch ? (
          <button type="button" onClick={onSwitch} className="font-medium text-indigo-600">
            {signup ? t.landing.login : t.landing.signup}
          </button>
        ) : (
          <Link
            href={`/${lang}/${signup ? 'login' : 'signup'}`}
            className="font-medium text-indigo-600"
          >
            {signup ? t.landing.login : t.landing.signup}
          </Link>
        )}
      </p>
    </Card>
  );
}
