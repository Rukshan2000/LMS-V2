'use client';

import { Copy, Download, ExternalLink, Globe, Save } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { refreshInstitutePage } from '@/app/[lang]/i/actions';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '../students/types';
import { useTenantData } from '../dashboard-shell';
import { btn, Button, card, Field, FormError, useToast } from '../ui';

interface Page {
  published: boolean;
  tagline: string | null;
  about: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  mapUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  showFees: boolean;
}
interface Batch {
  id: string;
  name: string;
  subject: string;
  onPage: boolean;
}
type TextKey = Exclude<keyof Page, 'published' | 'showFees'>;

/** Settings: the institute's public web page (/{lang}/i/{slug}). Owners and admins only. */
export function PageSettings() {
  const { lang, t } = useI18n();
  const p = t.pageSettings;
  const { tenant, roles } = useTenantData();
  const toast = useToast();
  const canEdit = roles.some((r) => r === 'owner' || r === 'admin');
  const [page, setPage] = useState<Page | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    api<{ page: Page; batches: Batch[] }>(`/tenants/${tenant.id}/page`)
      .then((r) => {
        // Phones arrive as 94771234567; edit them in the local form.
        setPage({
          ...r.page,
          phone: displayPhone(r.page.phone),
          whatsapp: displayPhone(r.page.whatsapp),
        });
        setBatches(r.batches);
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [canEdit, tenant.id, t]);

  if (!canEdit || !page) return null;
  // Only reached in the browser: page loads after mount.
  const url = `${window.location.origin}/${lang}/i/${tenant.slug}`;

  const text = (key: TextKey, label: string, extra: { hint?: string; type?: string } = {}) => (
    <Field
      label={label}
      hint={extra.hint}
      type={extra.type ?? 'text'}
      value={page[key] ?? ''}
      onChange={(e) => setPage({ ...page, [key]: e.target.value })}
    />
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/tenants/${tenant.id}/page`, {
        method: 'PUT',
        body: { ...page, batchIds: batches.filter((b) => b.onPage).map((b) => b.id) },
      });
      await refreshInstitutePage(tenant.slug);
      toast(p.saved);
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  async function downloadQr() {
    const a = document.createElement('a');
    a.href = await QRCode.toDataURL(url, { width: 1024, margin: 2 });
    a.download = `${tenant.slug}-qr.png`;
    a.click();
  }

  return (
    <form onSubmit={save} className={`${card} space-y-5 p-4`}>
      <div>
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Globe aria-hidden className="size-5 text-primary" />
          {p.title}
        </h2>
        <p className="text-sm text-ink-subtle">{p.hint}</p>
      </div>
      <FormError message={error} />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={page.published}
          onChange={(e) => setPage({ ...page, published: e.target.checked })}
        />
        <span>
          <span className="block font-medium">{p.published}</span>
          <span className="text-sm text-ink-subtle">{p.publishedHint}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-soft p-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{url}</span>
        <a href={url} target="_blank" rel="noopener" className={btn('secondary', 'xs')}>
          <ExternalLink aria-hidden className="size-3.5" />
          {p.view}
        </a>
        <button
          type="button"
          className={btn('secondary', 'xs')}
          onClick={() => navigator.clipboard.writeText(url).then(() => toast(p.copied))}
        >
          <Copy aria-hidden className="size-3.5" />
          {p.copyLink}
        </button>
        <button type="button" className={btn('secondary', 'xs')} onClick={downloadQr}>
          <Download aria-hidden className="size-3.5" />
          {p.qr}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{text('tagline', p.tagline, { hint: p.taglineHint })}</div>
        <div className="sm:col-span-2">
          <label htmlFor="page-about" className="mb-1 block text-sm font-medium text-ink-muted">
            {p.about}
          </label>
          <textarea
            id="page-about"
            rows={5}
            maxLength={4000}
            value={page.about ?? ''}
            onChange={(e) => setPage({ ...page, about: e.target.value })}
            className="w-full rounded-lg border border-line-strong px-3 py-2.5 text-base"
          />
        </div>
        {text('whatsapp', p.whatsapp, { hint: p.whatsappHint, type: 'tel' })}
        {text('phone', p.phone, { type: 'tel' })}
        {text('email', p.email, { type: 'email' })}
        {text('address', p.address)}
        <div className="sm:col-span-2">{text('mapUrl', p.mapUrl, { type: 'url' })}</div>
        {text('facebookUrl', p.facebook, { type: 'url' })}
        {text('youtubeUrl', p.youtube, { type: 'url' })}
        {text('tiktokUrl', p.tiktok, { type: 'url' })}
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">{p.classes}</legend>
        <p className="text-sm text-ink-subtle">{p.classesHint}</p>
        {batches.length === 0 ? (
          <p className="text-sm text-ink-subtle">{p.noClasses}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {batches.map((b) => (
              <label
                key={b.id}
                className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={b.onPage}
                  onChange={(e) =>
                    setBatches((list) =>
                      list.map((x) => (x.id === b.id ? { ...x, onPage: e.target.checked } : x)),
                    )
                  }
                />
                <span className="min-w-0 truncate">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-ink-subtle"> · {b.subject}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 pt-1 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={page.showFees}
            onChange={(e) => setPage({ ...page, showFees: e.target.checked })}
          />
          {p.showFees}
        </label>
      </fieldset>

      <Button type="submit" busy={busy} icon={Save} full={false}>
        {p.save}
      </Button>
    </form>
  );
}
