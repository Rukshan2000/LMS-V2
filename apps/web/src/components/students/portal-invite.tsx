'use client';

import { Copy, Mail, MailCheck, MessageCircle, Smartphone } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { btn, card, FormError, useToast } from '../ui';
import { type Student } from './types';

/** Email the parent/student app link. Only the chosen email can open it. */
export function PortalInvite({ student }: { student: Student }) {
  const { lang, t } = useI18n();
  const p = t.portal;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { tenant } = useTenantData();
  const toast = useToast();
  // Per email: the link just created (to copy or send on WhatsApp as a fallback).
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const people = [
    ...(student.email
      ? [{ name: student.fullName, email: student.email, phone: student.phone }]
      : []),
    ...student.guardians.flatMap((g) =>
      g.email ? [{ name: g.fullName, email: g.email, phone: g.phone }] : [],
    ),
  ];

  async function send(email: string) {
    setError(null);
    try {
      const { code, emailSent } = await api<{ code: string; emailSent: boolean }>(
        `/tenants/${tenantId}/students/${student.id}/portal-invite`,
        { method: 'POST', body: { email } },
      );
      setLinks((l) => ({ ...l, [email]: `${window.location.origin}/${lang}/join/${code}` }));
      if (emailSent) toast(fmt(t.staff.emailSent, { email }));
      else setError(t.staff.emailFailed);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <section className={`${card} space-y-3 p-4 text-sm`}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Smartphone aria-hidden className="size-5 text-primary" />
          {p.invite}
        </h2>
        <p className="text-ink-subtle">{p.inviteHint}</p>
      </div>
      {people.length === 0 && <p className="text-ink-subtle">{p.noEmails}</p>}
      <ul className="space-y-2">
        {people.map(({ name, email, phone }) => {
          const link = links[email];
          const text = fmt(p.message, {
            name,
            student: student.fullName,
            institute: tenant.name,
            link: link ?? '',
          });
          return (
            <li key={email} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {name} <span className="text-ink-subtle">{email}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {link ? (
                  <>
                    <span className="flex items-center gap-1 text-success">
                      <MailCheck aria-hidden className="size-4" />
                      {p.emailed}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(link).then(
                          () => toast(t.staff.copied),
                          () => {},
                        )
                      }
                      className={btn('link', 'none')}
                    >
                      <Copy aria-hidden className="size-4" />
                      {t.staff.copyLink}
                    </button>
                    {phone && (
                      <a
                        href={waLink(phone, text)}
                        target="_blank"
                        rel="noreferrer"
                        className={btn('whatsapp')}
                      >
                        <MessageCircle aria-hidden className="size-4" />
                        {p.openWhatsApp}
                      </a>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => send(email)} className={btn('secondary')}>
                    <Mail aria-hidden className="size-4" />
                    {p.sendEmail}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
    </section>
  );
}
