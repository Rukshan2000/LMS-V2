'use client';

import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { Button, FormError } from './ui';

const MAX_SIDE = 1600;

/** Phone photos are 3–10 MB: shrink to ≤1600px JPEG (~300 KB) before upload. PDFs go as-is. */
async function toDataUrl(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Portal: send a photo of the bank deposit slip for one student. */
export function SlipUpload({
  studentId,
  outstanding,
  onDone,
}: {
  studentId: string;
  outstanding: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const s = t.slips;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per form: a double tap or retry is recorded once.
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file') as File;
    setBusy(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/portal/slips`, {
        method: 'POST',
        body: {
          studentId,
          amount: form.get('amount'),
          reference: form.get('reference') || null,
          file: await toDataUrl(file),
          clientRef,
        },
      });
      setOpen(false);
      setClientRef(crypto.randomUUID());
      onDone();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium"
      >
        {s.upload}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg bg-zinc-50 p-3 text-sm">
      <label className="block">
        <span className="text-zinc-600">{s.photo}</span>
        <input
          name="file"
          type="file"
          accept="image/*,application/pdf"
          required
          className="mt-1 block w-full"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className="text-zinc-600">{t.fees.amount}</span>
          <input
            name="amount"
            inputMode="decimal"
            required
            defaultValue={outstanding}
            className="mt-1 block w-32 rounded-lg border border-zinc-300 px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-zinc-600">{t.fees.reference}</span>
          <input
            name="reference"
            maxLength={100}
            className="mt-1 block w-44 rounded-lg border border-zinc-300 px-2 py-1.5"
          />
        </label>
      </div>
      <FormError message={error} />
      <Button type="submit" busy={busy}>
        {s.send}
      </Button>
    </form>
  );
}
