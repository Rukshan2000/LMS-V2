'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt, type Role } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import { displayPhone } from '../students/types';
import { useTenantData } from '../dashboard-shell';
import { Button, Field, FormError } from '../ui';

interface Member {
  membershipId: string;
  fullName: string;
  phone: string;
  roles: Role[];
}
interface Invite {
  id: string;
  fullName: string;
  phone: string;
  role: Role;
  expiresAt: string;
  /** Only known right after creating it in this browser (the server stores a hash). */
  link?: string;
}

export function StaffSettings() {
  const { lang, t } = useI18n();
  const st = t.staff;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { tenant, me } = useTenantData();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [form, setForm] = useState({ fullName: '', phone: '', role: 'teacher' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const load = useCallback(() => {
    api<{ members: Member[] }>(`/tenants/${tenantId}/members`)
      .then((r) => setMembers(r.members))
      .catch(fail);
    api<{ invites: Invite[] }>(`/tenants/${tenantId}/invites`)
      .then((r) =>
        setInvites((old) =>
          r.invites.map((i) => ({ ...i, link: old.find((o) => o.id === i.id)?.link })),
        ),
      )
      .catch(fail);
  }, [tenantId, fail]);
  useEffect(load, [load]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ invite: Invite; code: string }>(`/tenants/${tenantId}/invites`, {
        method: 'POST',
        body: form,
      });
      const link = `${window.location.origin}/${lang}/join/${res.code}`;
      setInvites((list) => [
        { ...res.invite, link },
        ...list.filter((i) => i.phone !== res.invite.phone),
      ]);
      setForm({ fullName: '', phone: '', role: 'teacher' });
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  }

  const whatsapp = (i: Invite) =>
    `https://wa.me/${i.phone}?text=${encodeURIComponent(
      fmt(st.message, {
        name: i.fullName,
        institute: tenant.name,
        role: t.roles[i.role],
        url: i.link ?? '',
      }),
    )}`;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{st.title}</h1>
      <FormError message={error} />

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">{st.staff}</h2>
        <ul className="divide-y divide-zinc-100">
          {members.map((m) => (
            <li
              key={m.membershipId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{m.fullName}</span>
                {m.fullName === me.user.fullName && m.phone === me.user.phone && (
                  <span className="text-zinc-500"> {st.you}</span>
                )}
                <span className="block text-zinc-500">
                  {displayPhone(m.phone)} · {m.roles.map((r) => t.roles[r]).join(', ')}
                </span>
              </span>
              {!m.roles.includes('owner') && m.phone !== me.user.phone && (
                <button
                  type="button"
                  onClick={() =>
                    api(`/tenants/${tenantId}/members/${m.membershipId}`, { method: 'DELETE' })
                      .then(() =>
                        setMembers((ms) => ms.filter((x) => x.membershipId !== m.membershipId)),
                      )
                      .catch(fail)
                  }
                  className="text-red-600"
                >
                  {st.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">{st.invite}</h2>
        <form
          onSubmit={onInvite}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
        >
          <Field
            label={st.name}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
            maxLength={200}
          />
          <Field
            label={st.phone}
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
            placeholder="077 123 4567"
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700">{st.role}</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
            >
              {(['teacher', 'receptionist', 'admin'] as const).map((r) => (
                <option key={r} value={r}>
                  {t.roles[r]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" busy={busy}>
            {st.create}
          </Button>
        </form>

        <h3 className="pt-2 text-sm font-medium text-zinc-700">{st.pending}</h3>
        {invites.length === 0 && <p className="text-sm text-zinc-500">{st.noPending}</p>}
        <ul className="divide-y divide-zinc-100">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{i.fullName}</span> · {t.roles[i.role]}
                <span className="block text-zinc-500">
                  {displayPhone(i.phone)} · {fmt(st.expires, { date: colomboDate(i.expiresAt) })}
                </span>
              </span>
              {i.link && (
                <>
                  <a
                    href={whatsapp(i)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white"
                  >
                    {st.sendWhatsApp}
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(i.link!).then(
                        () => setNotice(st.copied),
                        () => {},
                      )
                    }
                    className="text-indigo-600"
                  >
                    {st.copyLink}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() =>
                  api(`/tenants/${tenantId}/invites/${i.id}`, { method: 'DELETE' })
                    .then(() => setInvites((list) => list.filter((x) => x.id !== i.id)))
                    .catch(fail)
                }
                className="text-red-600"
              >
                {st.revoke}
              </button>
            </li>
          ))}
        </ul>
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
