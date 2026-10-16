'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, fmtTime } from '@/lib/datetime';
import { fmtMoney } from '@/lib/money';
import { displayPhone } from '../students/types';
import { FormError } from '../ui';

type Status = 'pending' | 'verified' | 'rejected';
interface Slip {
  id: string;
  amount: string;
  reference: string | null;
  status: Status;
  receiptNumber: string | null;
  reviewNote: string | null;
  submittedAt: string;
  contentType: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  submittedBy: string | null;
  submittedByPhone: string | null;
  outstanding: string;
  duplicateFile: boolean;
  duplicateReference: boolean;
}

/** Desk review of uploaded bank slips: check the photo, then verify (receipt) or reject. */
export function SlipsPage() {
  const { lang, t } = useI18n();
  const s = t.slips;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [status, setStatus] = useState<Status>('pending');
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ slips: Slip[] }>(`/tenants/${tenantId}/slips?status=${status}`)
      .then((r) => setSlips(r.slips))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, status, t]);
  useEffect(load, [load]);

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t.nav.slips}</h1>
      <div className="flex gap-2 text-sm">
        {(['pending', 'verified', 'rejected'] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatus(st)}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              status === st ? 'bg-indigo-600 text-white' : 'border border-zinc-300'
            }`}
          >
            {s.status[st]}
          </button>
        ))}
      </div>
      <FormError message={error} />
      {slips === null ? (
        <p className="text-zinc-500">{t.loading}</p>
      ) : slips.length === 0 ? (
        <p className="text-zinc-500">{s.none}</p>
      ) : (
        <ul className="space-y-4">
          {slips.map((slip) => (
            <SlipCard key={slip.id} slip={slip} onChange={load} lang={lang} tenantId={tenantId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SlipCard({
  slip,
  onChange,
  lang,
  tenantId,
}: {
  slip: Slip;
  onChange: () => void;
  lang: string;
  tenantId: string;
}) {
  const { t } = useI18n();
  const s = t.slips;
  const [amount, setAmount] = useState(slip.amount);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileUrl = `/api/v1/tenants/${tenantId}/slips/${slip.id}/file`;

  async function act(action: 'verify' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/slips/${slip.id}/${action}`, {
        method: 'POST',
        body: action === 'verify' ? { amount } : { note },
      });
      onChange();
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row">
      <a href={fileUrl} target="_blank" rel="noreferrer" className="shrink-0">
        {slip.contentType === 'application/pdf' ? (
          <span className="flex h-40 w-32 items-center justify-center rounded-lg border border-zinc-300 text-sm">
            PDF
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-only image
          <img
            src={fileUrl}
            alt={s.photo}
            className="h-40 w-full rounded-lg border border-zinc-200 object-contain sm:w-48"
          />
        )}
      </a>
      <div className="flex-1 space-y-2 text-sm">
        <p>
          <Link
            href={`/${lang}/t/${tenantId}/students/${slip.studentId}`}
            className="font-medium text-indigo-600"
          >
            {slip.studentNumber} {slip.studentName}
          </Link>
        </p>
        <p>
          LKR <span className="font-mono">{fmtMoney(slip.amount)}</span>
          {slip.reference && <span className="text-zinc-500"> · {slip.reference}</span>}
        </p>
        <p className="text-zinc-500">
          {colomboDate(slip.submittedAt)} {fmtTime(slip.submittedAt)} · {slip.submittedBy}{' '}
          {displayPhone(slip.submittedByPhone)}
        </p>
        {slip.duplicateFile && <p className="font-medium text-red-700">{s.duplicateFile}</p>}
        {slip.duplicateReference && (
          <p className="font-medium text-red-700">{s.duplicateReference}</p>
        )}
        {slip.status === 'pending' && (
          <>
            <p className="text-zinc-600">
              {fmt(t.fees.outstandingTotal, { amount: fmtMoney(slip.outstanding) })}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="block text-zinc-600">{t.fees.amount}</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 w-32 rounded-lg border border-zinc-300 px-2 py-1.5"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => act('verify')}
                className="rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white disabled:opacity-60"
              >
                {s.verify}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder={s.rejectReason}
                className="w-56 rounded-lg border border-zinc-300 px-2 py-1.5"
              />
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => act('reject')}
                className="rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-700 disabled:opacity-60"
              >
                {s.reject}
              </button>
            </div>
          </>
        )}
        {slip.status === 'verified' && (
          <Link
            href={`/${lang}/t/${tenantId}/payments/${slip.id}`}
            className="font-medium text-indigo-600"
          >
            {fmt(t.fees.receiptNo, { number: slip.receiptNumber ?? '' })}
          </Link>
        )}
        {slip.status === 'rejected' && <p className="text-red-700">{slip.reviewNote}</p>}
        <FormError message={error} />
      </div>
    </li>
  );
}
