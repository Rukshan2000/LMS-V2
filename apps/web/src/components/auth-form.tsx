'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { LogIn, Mail, UserPlus } from 'lucide-react';
import { Brand, Button, Card, Field, FormError } from './ui';

const linkClass =
  'font-medium text-primary transition-colors hover:text-primary-hover hover:underline';

/** 6-digit code input; the browser can fill it from the email on phones. */
export function CodeField({ label }: { label: string }) {
  return (
    <Field
      label={label}
      name="code"
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      placeholder="123456"
    />
  );
}

export function AuthForm({
  mode,
  email: lockedEmail,
  fullName,
  onDone,
  onSwitch,
}: {
  mode: 'login' | 'signup';
  /** Prefill and lock the email (invite and account links). */
  email?: string;
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
  // Signup: the email a code was sent to (step 2), or null (step 1).
  const [sentTo, setSentTo] = useState<string | null>(null);

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
  const done = () => (onDone ? onDone() : router.replace(`/${lang}/app`));
  const sendCode = (email: string) =>
    run(async () => {
      await api('/auth/signup/start', { method: 'POST', body: { email } });
      setSentTo(email);
    });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (mode === 'login') {
      return run(async () => {
        await api('/auth/login', { method: 'POST', body: form });
        done();
      });
    }
    if (!sentTo) return sendCode(form.email!);
    return run(async () => {
      await api('/auth/signup/verify', { method: 'POST', body: { ...form, email: sentTo } });
      done();
    });
  }

  const signup = mode === 'signup';
  return (
    <Card>
      <div className="mb-5">
        <Brand />
      </div>
      <h1 className="mb-6 text-xl font-semibold">
        {signup ? t.auth.signupTitle : t.auth.loginTitle}
      </h1>
      <form onSubmit={onSubmit} className="space-y-4">
        {!signup && (
          <>
            <Field
              label={t.auth.email}
              name="identifier"
              type="text"
              inputMode="email"
              autoComplete="username"
              required
              defaultValue={lockedEmail}
              hint={t.auth.identifierHint}
            />
            <Field
              label={t.auth.password}
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </>
        )}
        {signup && !sentTo && (
          <Field
            label={t.auth.email}
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={lockedEmail}
            readOnly={lockedEmail !== undefined}
          />
        )}
        {signup && sentTo && (
          <>
            <p className="text-sm text-ink-muted">{fmt(t.auth.codeSent, { email: sentTo })}</p>
            <CodeField label={t.auth.code} />
            <Field
              label={t.auth.fullName}
              name="fullName"
              required
              autoComplete="name"
              defaultValue={fullName}
            />
            <Field
              label={t.auth.phoneOptional}
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="077 123 4567"
              autoComplete="tel"
            />
            <Field
              label={t.auth.password}
              name="password"
              type="password"
              required
              minLength={8}
              hint={t.auth.passwordHint}
              autoComplete="new-password"
            />
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <input type="checkbox" name="acceptPrivacy" required className="mt-1" />
              <span>
                {t.auth.acceptPrivacy}{' '}
                <Link href={`/${lang}/privacy`} target="_blank" className={linkClass}>
                  {t.privacy.title}
                </Link>
              </span>
            </label>
          </>
        )}
        <FormError message={error} />
        <Button type="submit" busy={busy} icon={!signup ? LogIn : sentTo ? UserPlus : Mail}>
          {!signup ? t.auth.loginButton : sentTo ? t.auth.signupButton : t.auth.sendCode}
        </Button>
        {signup && sentTo && (
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" className={linkClass} onClick={() => sendCode(sentTo)}>
              {t.auth.resendCode}
            </button>
            {lockedEmail === undefined && (
              <button type="button" className={linkClass} onClick={() => setSentTo(null)}>
                {t.auth.otherEmail}
              </button>
            )}
          </div>
        )}
        {!signup && (
          <p className="text-right text-sm">
            <Link href={`/${lang}/forgot-password`} className={linkClass}>
              {t.auth.forgot}
            </Link>
          </p>
        )}
      </form>
      <p className="mt-6 text-center text-sm text-ink-muted">
        {signup ? t.auth.haveAccount : t.auth.noAccount}{' '}
        {onSwitch ? (
          <button type="button" onClick={onSwitch} className={linkClass}>
            {signup ? t.landing.login : t.landing.signup}
          </button>
        ) : (
          <Link href={`/${lang}/${signup ? 'login' : 'signup'}`} className={linkClass}>
            {signup ? t.landing.login : t.landing.signup}
          </Link>
        )}
      </p>
    </Card>
  );
}
