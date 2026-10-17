'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { Button, card, FormError, Skeleton, useToast } from '../ui';

const NUMBERS = ['trial_days', 'grace_days', 'invoice_due_days'] as const;
const TEXTS = ['trial_caps', 'support_whatsapp', 'bank_details'] as const;
type Key = (typeof NUMBERS)[number] | (typeof TEXTS)[number];

/** Text box → setting value. Empty = not set (null). trial_caps is JSON. */
function parse(key: Key, raw: string): unknown {
  if ((NUMBERS as readonly string[]).includes(key)) return Number(raw);
  if (raw.trim() === '') return null;
  return key === 'trial_caps' ? JSON.parse(raw) : raw.trim();
}

export function SettingsPage() {
  const { t } = useI18n();
  const s = t.admin.settings;
  const toast = useToast();
  const [form, setForm] = useState<Record<Key, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: Record<Key, unknown> }>('/admin/settings')
      .then(({ settings }) =>
        setForm(
          Object.fromEntries(
            [...NUMBERS, ...TEXTS].map((k) => {
              const v = settings[k];
              return [k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)];
            }),
          ) as Record<Key, string>,
        ),
      )
      .catch((err) => setError(errorMessage(t, err)));
  }, [t]);

  async function save(key: Key) {
    setError(null);
    try {
      await api(`/admin/settings/${key}`, {
        method: 'PUT',
        body: { value: parse(key, form![key]) },
      });
      toast(s.saved);
    } catch (err) {
      // JSON.parse errors land here too.
      setError(errorMessage(t, err));
    }
  }

  if (!form) return error ? <FormError message={error} /> : <Skeleton />;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{s.title}</h1>
      <FormError message={error} />
      {[...NUMBERS, ...TEXTS].map((key) => (
        <form
          key={key}
          onSubmit={(e) => {
            e.preventDefault();
            save(key);
          }}
          className={`${card} space-y-2 p-4`}
        >
          <label className="block text-sm font-medium text-ink-muted">
            {s[key]}
            {key === 'bank_details' ? (
              <textarea
                rows={4}
                maxLength={1000}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink"
              />
            ) : (
              <input
                type={(NUMBERS as readonly string[]).includes(key) ? 'number' : 'text'}
                inputMode={key === 'support_whatsapp' ? 'tel' : undefined}
                required={(NUMBERS as readonly string[]).includes(key)}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink"
              />
            )}
          </label>
          <Button full={false} size="sm">
            {s.save}
          </Button>
        </form>
      ))}
    </div>
  );
}
