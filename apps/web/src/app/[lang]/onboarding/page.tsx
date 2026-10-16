'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Field, FormError } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage } from '@/lib/api';

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export default function Onboarding() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/me').catch((err) => {
      if (err instanceof ApiError && err.status === 401) router.replace(`/${lang}/login`);
    });
  }, [lang, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { tenant } = await api<{ tenant: { id: string } }>('/tenants', {
        method: 'POST',
        body: { name, slug },
      });
      router.replace(`/${lang}/t/${tenant.id}`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <Card>
        <h1 className="mb-6 text-xl font-semibold">{t.onboarding.title}</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label={t.onboarding.name}
            value={name}
            required
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
          />
          <Field
            label={t.onboarding.slug}
            hint={t.onboarding.slugHint}
            value={slug}
            required
            pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
          <FormError message={error} />
          <Button type="submit" busy={busy}>
            {t.onboarding.create}
          </Button>
        </form>
      </Card>
    </main>
  );
}
