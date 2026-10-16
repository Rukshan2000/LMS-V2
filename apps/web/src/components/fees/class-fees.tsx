'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { FormError } from '../ui';

type Kind = 'class' | 'ac' | 'tute';

/** Monthly fee components of one class (owner/admin). */
export function ClassFees({ batchId }: { batchId: string }) {
  const { t } = useI18n();
  const f = t.fees;
  const { tenantId } = useParams<{ tenantId: string }>();
  const url = `/tenants/${tenantId}/batches/${batchId}/fees`;
  const [fees, setFees] = useState<Record<Kind, string>>({ class: '', ac: '', tute: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ fees: { kind: Kind; amount: string }[] }>(url)
      .then((r) =>
        setFees((x) => ({
          ...x,
          ...Object.fromEntries(r.fees.map((fee) => [fee.kind, fee.amount])),
        })),
      )
      .catch(() => {});
  }, [url]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    try {
      const body = Object.fromEntries(Object.entries(fees).filter(([, v]) => v !== ''));
      await api(url, { method: 'PUT', body });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  const labels: Record<Kind, string> = { class: f.classFee, ac: f.acFee, tute: f.tuteFee };
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="font-medium">{f.classFees}</h2>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2 text-sm">
        {(['class', 'ac', 'tute'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1">
            {labels[k]} (LKR)
            <input
              inputMode="decimal"
              pattern="\d{1,10}(\.\d{1,2})?"
              value={fees[k]}
              onChange={(e) => setFees({ ...fees, [k]: e.target.value })}
              className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5"
            />
          </label>
        ))}
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white"
        >
          {f.saveFees}
        </button>
        {saved && (
          <span role="status" className="text-green-700">
            {f.saved}
          </span>
        )}
      </form>
      <FormError message={error} />
    </section>
  );
}
