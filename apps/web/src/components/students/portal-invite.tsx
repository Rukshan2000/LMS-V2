'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';
import { displayPhone, type Student } from './types';

/** Send the parent/student app link on WhatsApp. Only the chosen mobile can open it. */
export function PortalInvite({ student }: { student: Student }) {
  const { lang, t } = useI18n();
  const p = t.portal;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { tenant } = useTenantData();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const people = [
    ...(student.phone ? [{ name: student.fullName, phone: student.phone }] : []),
    ...student.guardians.map((g) => ({ name: g.fullName, phone: g.phone })),
  ];

  async function create(name: string, phone: string) {
    setError(null);
    try {
      const { code } = await api<{ code: string }>(
        `/tenants/${tenantId}/students/${student.id}/portal-invite`,
        { method: 'POST', body: { phone } },
      );
      const link = `${window.location.origin}/${lang}/join/${code}`;
      const text = fmt(p.message, {
        name,
        student: student.fullName,
        institute: tenant.name,
        link,
      });
      setLinks((l) => ({ ...l, [phone]: waLink(phone, text) }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <div>
        <h2 className="font-medium">{p.invite}</h2>
        <p className="text-zinc-500">{p.inviteHint}</p>
      </div>
      {people.length === 0 && <p className="text-zinc-500">{p.noPhones}</p>}
      <ul className="space-y-2">
        {people.map(({ name, phone }) => (
          <li key={phone} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {name} <span className="text-zinc-500">{displayPhone(phone)}</span>
            </span>
            {links[phone] ? (
              <a
                href={links[phone]}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white"
              >
                {p.openWhatsApp}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => create(name, phone)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium"
              >
                {p.createLink}
              </button>
            )}
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </section>
  );
}
