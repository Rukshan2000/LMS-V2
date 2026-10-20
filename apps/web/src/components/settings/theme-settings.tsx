'use client';

import { Check, Palette } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { useTenantData } from '../dashboard-shell';
import { card, FormError, useToast } from '../ui';

// Same list as THEMES in the API (tenancy routes) and the [data-theme] blocks in globals.css.
const THEMES = ['blue', 'teal', 'green', 'purple', 'rose', 'orange'] as const;

/** Settings: the institute's accent colour. Owners and admins only. */
export function ThemeSettings() {
  const { t } = useI18n();
  const { tenant, roles, updateTenant } = useTenantData();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  if (!roles.some((r) => r === 'owner' || r === 'admin')) return null;

  async function pick(theme: string) {
    if (theme === tenant.theme) return;
    const before = tenant.theme;
    setError(null);
    updateTenant({ theme }); // show it at once; undo if saving fails
    try {
      await api(`/tenants/${tenant.id}`, { method: 'PATCH', body: { theme } });
      toast(t.theme.saved);
    } catch (err) {
      updateTenant({ theme: before });
      setError(errorMessage(t, err));
    }
  }

  return (
    <section className={`${card} space-y-4 p-4`}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Palette aria-hidden className="size-5 text-primary" />
          {t.theme.title}
        </h2>
        <p className="text-sm text-ink-subtle">{t.theme.hint}</p>
      </div>
      <FormError message={error} />
      <div role="radiogroup" aria-label={t.theme.title} className="flex flex-wrap gap-3">
        {THEMES.map((name) => {
          const selected = tenant.theme === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(name)}
              data-theme={name}
              className={`flex items-center gap-2 rounded-lg border bg-surface py-1.5 pl-1.5 pr-3 text-sm transition-colors ${
                selected
                  ? 'border-primary ring-3 ring-primary-ring'
                  : 'border-line hover:border-line-strong'
              }`}
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-white">
                {selected && <Check aria-hidden className="size-4" />}
              </span>
              {t.theme.names[name]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
