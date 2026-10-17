'use client';

import { Printer, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { btn, card, FormError, FormSuccess } from '../ui';

/** Print a student's QR card, or replace a lost one (the old QR stops working). */
export function StudentCard({ studentId }: { studentId: string }) {
  const { lang, t } = useI18n();
  const c = t.cards;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function replace() {
    try {
      await api(`/tenants/${tenantId}/students/${studentId}/card/replace`, { method: 'POST' });
      setDone(true);
      setConfirming(false);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <section className={`${card} flex flex-wrap items-center gap-3 p-4 text-sm`}>
      <Link href={`/${lang}/t/${tenantId}/students/${studentId}/card`} className={btn('secondary')}>
        <Printer aria-hidden className="size-4" />
        {c.printOne}
      </Link>
      {confirming ? (
        <button type="button" onClick={replace} className={`${btn('danger')} animate-pop-in`}>
          <TriangleAlert aria-hidden className="size-4" />
          {c.confirmReplace}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={btn('linkDanger', 'none')}
        >
          <RefreshCw aria-hidden className="size-4" />
          {c.replace}
        </button>
      )}
      {done && (
        <div className="w-full">
          <FormSuccess>{c.replaced}</FormSuccess>
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}
