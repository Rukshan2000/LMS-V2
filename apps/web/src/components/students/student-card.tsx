'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { FormError } from '../ui';

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
    <section className="flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <Link
        href={`/${lang}/t/${tenantId}/students/${studentId}/card`}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium"
      >
        {c.printOne}
      </Link>
      {confirming ? (
        <button
          type="button"
          onClick={replace}
          className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white"
        >
          {c.confirmReplace}
        </button>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-red-600">
          {c.replace}
        </button>
      )}
      {done && (
        <p role="status" className="w-full text-green-700">
          {c.replaced}
        </p>
      )}
      <FormError message={error} />
    </section>
  );
}
