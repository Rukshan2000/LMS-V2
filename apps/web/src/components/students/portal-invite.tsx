'use client';

import { Link2, MessageCircle, Smartphone } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { btn, card, FormError } from '../ui';
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
    <section className={`${card} max-w-xl space-y-3 p-4 text-sm`}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Smartphone aria-hidden className="size-5 text-primary" />
          {p.invite}
        </h2>
        <p className="text-ink-subtle">{p.inviteHint}</p>
      </div>
      {people.length === 0 && <p className="text-ink-subtle">{p.noPhones}</p>}
      <ul className="space-y-2">
        {people.map(({ name, phone }) => (
          <li key={phone} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {name} <span className="text-ink-subtle">{displayPhone(phone)}</span>
            </span>
            {links[phone] ? (
              <a
                href={links[phone]}
                target="_blank"
                rel="noreferrer"
                className={`${btn('whatsapp')} animate-pop-in`}
              >
                <MessageCircle aria-hidden className="size-4" />
                {p.openWhatsApp}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => create(name, phone)}
                className={btn('secondary')}
              >
                <Link2 aria-hidden className="size-4" />
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
