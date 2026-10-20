'use client';

import { LogOut, TicketCheck } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt, type Me, type Role } from '@/lib/api';
import { AuthForm } from './auth-form';
import { displayPhone } from './students/types';
import { btn, Button, Card, FormError, Spinner } from './ui';

interface Invite {
  fullName: string;
  /** Who may accept. Invites from before email login have only a phone. */
  email: string | null;
  phone: string | null;
  role: Role;
  tenantId: string;
  tenantName: string;
}

export function JoinInvite() {
  const { lang, t } = useI18n();
  const j = t.join;
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null | 'invalid'>(null);
  const [me, setMe] = useState<Me | null | 'anonymous'>(null);
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMe = useCallback(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe('anonymous'));
  }, []);

  useEffect(() => {
    api<{ invite: Invite }>(`/invites/${code}`)
      .then((r) => setInvite(r.invite))
      .catch(() => setInvite('invalid'));
    loadMe();
  }, [code, loadMe]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { tenantId } = await api<{ tenantId: string }>(`/invites/${code}/accept`, {
        method: 'POST',
      });
      router.replace(`/${lang}/t/${tenantId}`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setMe('anonymous');
  }

  if (invite === null || me === null) return <Spinner label={t.loading} />;
  if (invite === 'invalid') {
    return (
      <main className="flex flex-1 items-center justify-center bg-linear-to-b from-canvas to-accent-sky/50 px-4 py-10">
        <Card>
          <p className="text-ink-muted">{j.invalid}</p>
        </Card>
      </main>
    );
  }

  const intro = fmt(j.body, {
    institute: invite.tenantName,
    name: invite.fullName,
    role: t.roles[invite.role],
  });
  // Logged in as someone else than the invite is for (e.g. the owner who sent it).
  const wrongUser =
    me !== 'anonymous' &&
    (invite.email
      ? !me.user.emailVerified || me.user.email?.toLowerCase() !== invite.email.toLowerCase()
      : me.user.phone !== invite.phone);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-linear-to-b from-canvas to-accent-sky/50 px-4 py-10">
      <div className="flex max-w-sm animate-fade-in flex-col items-center text-center">
        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-accent-sky/70 text-primary">
          <TicketCheck aria-hidden className="size-6" />
        </span>
        <h1 className="text-xl font-semibold">{j.title}</h1>
        <p className="mt-2 text-ink-muted">{intro}</p>
      </div>
      {me === 'anonymous' ? (
        <>
          <p className="max-w-sm text-center text-sm text-ink-muted">{j.signupFirst}</p>
          <AuthForm
            key={mode}
            mode={mode}
            email={invite.email ?? undefined}
            fullName={invite.fullName}
            onDone={loadMe}
            onSwitch={() => setMode((m) => (m === 'signup' ? 'login' : 'signup'))}
          />
        </>
      ) : wrongUser ? (
        <Card>
          <p className="text-ink-muted">
            {invite.email
              ? fmt(j.wrongEmail, { email: invite.email })
              : fmt(j.wrongPhone, { phone: displayPhone(invite.phone ?? '') })}
          </p>
          <button type="button" onClick={logout} className={`mt-4 text-sm ${btn('link', 'none')}`}>
            <LogOut aria-hidden className="size-4" />
            {t.dashboard.logout}
          </button>
        </Card>
      ) : (
        <Card>
          <FormError message={error} />
          <Button type="button" busy={busy} onClick={accept}>
            {j.accept}
          </Button>
        </Card>
      )}
    </main>
  );
}
