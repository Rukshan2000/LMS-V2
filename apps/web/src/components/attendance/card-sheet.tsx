'use client';

import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';

interface Card {
  studentId: string;
  studentNumber: string;
  fullName: string;
  grade: string | null;
  token: string;
  qr?: string;
}

/** Printable A4 sheet of QR class cards for a class, or for one student. */
export function CardSheet() {
  const { t } = useI18n();
  const { tenantId, batchId, studentId } = useParams<{
    tenantId: string;
    batchId?: string;
    studentId?: string;
  }>();
  const { tenant } = useTenantData();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ cards: Card[] }>(`/tenants/${tenantId}/cards`, {
      method: 'POST',
      body: batchId ? { batchId } : { studentIds: [studentId] },
    })
      .then(async ({ cards }) =>
        setCards(
          await Promise.all(
            cards.map(async (c) => ({
              ...c,
              qr: await QRCode.toString(c.token, {
                type: 'svg',
                margin: 0,
                errorCorrectionLevel: 'M',
              }),
            })),
          ),
        ),
      )
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, batchId, studentId, t]);

  if (!cards)
    return error ? <FormError message={error} /> : <p className="text-zinc-500">{t.loading}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="mr-auto text-2xl font-semibold">{t.cards.title}</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          {t.cards.printNow}
        </button>
        <p className="w-full text-sm text-zinc-500">{t.cards.hint}</p>
      </div>
      {/* 85.6 × 54 mm = bank-card size; 2 columns fit A4 with margins. */}
      <div className="grid grid-cols-[repeat(auto-fill,85.6mm)] gap-[4mm]">
        {cards.map((c) => (
          <div
            key={c.studentId}
            className="flex h-[54mm] w-[85.6mm] break-inside-avoid gap-3 rounded-lg border border-zinc-400 bg-white p-[4mm]"
          >
            <div
              className="h-[44mm] w-[44mm] shrink-0"
              dangerouslySetInnerHTML={{ __html: c.qr! }}
            />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-zinc-500">{tenant.name}</span>
              <span className="mt-1 text-base font-semibold leading-tight">{c.fullName}</span>
              {c.grade && <span className="text-sm text-zinc-600">{c.grade}</span>}
              <span className="mt-auto font-mono text-2xl font-bold">{c.studentNumber}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
