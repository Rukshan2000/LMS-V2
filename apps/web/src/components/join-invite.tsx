'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt, type Me, type Role } from '@/lib/api';
import { AuthForm } from './auth-form';
import { displayPhone } from './students/types';
import { Button, Card, FormError, Spinner } from './ui';

interface Invite {
  fullName: string;
  phone: string;
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
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card>
          <p className="text-zinc-700">{j.invalid}</p>
        </Card>
      </main>
    );
  }

  const intro = fmt(j.body, {
    institute: invite.tenantName,
    name: invite.fullName,
    role: t.roles[invite.role],
  });
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">{j.title}</h1>
        <p className="mt-2 text-zinc-700">{intro}</p>
      </div>
      {me === 'anonymous' ? (
        <>
          <p className="max-w-sm text-center text-sm text-zinc-600">{j.signupFirst}</p>
          <AuthForm
            key={mode}
            mode={mode}
            phone={displayPhone(invite.phone)}
            fullName={invite.fullName}
            onDone={loadMe}
            onSwitch={() => setMode((m) => (m === 'signup' ? 'login' : 'signup'))}
          />
        </>
      ) : me.user.phone !== invite.phone ? (
        <Card>
          <p className="text-zinc-700">
            {fmt(j.wrongPhone, { phone: displayPhone(invite.phone) })}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-4 text-sm font-medium text-indigo-600"
          >
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
