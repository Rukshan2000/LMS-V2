'use client';

import { Download, ExternalLink, FileText, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { colomboDate } from '@/lib/datetime';
import type { BatchSummary } from './classes/types';
import { useIsFamily } from './portal';
import {
  Badge,
  btn,
  Button,
  card,
  ConfirmButton,
  EmptyState,
  Field,
  FormError,
  Skeleton,
  useToast,
} from './ui';

// Tutes: class notes shared as a download link (Google Drive, Dropbox…). Teachers, owners and
// admins add them per class; students and parents download the ones for their classes.

interface Tute {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
}

export function Tutes() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.tutes.title}</h1>
      {useIsFamily() ? <PortalTutes /> : <TuteManager />}
    </div>
  );
}

const EMPTY = { batchId: '', title: '', description: '', url: '' };

function TuteManager() {
  const { t } = useI18n();
  const tt = t.tutes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const toast = useToast();
  const [tutes, setTutes] = useState<Tute[] | null>(null);
  const [classes, setClasses] = useState<BatchSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ tutes: Tute[] }>(`/tenants/${tenantId}/tutes`)
      .then((r) => setTutes(r.tutes))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, t]);
  useEffect(() => {
    load();
    // Teachers get only the classes they teach.
    api<{ batches: BatchSummary[] }>(`/tenants/${tenantId}/batches`)
      .then((r) => {
        setClasses(r.batches);
        setForm((f) => (f.batchId ? f : { ...f, batchId: r.batches[0]?.id ?? '' }));
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, t, load]);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, description: form.description || null };
      if (editing) {
        await api(`/tenants/${tenantId}/tutes/${editing}`, { method: 'PATCH', body });
        toast(tt.saved);
      } else {
        await api(`/tenants/${tenantId}/tutes`, { method: 'POST', body });
        toast(tt.added);
      }
      setEditing(null);
      setForm((f) => ({ ...EMPTY, batchId: f.batchId }));
      load();
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  function edit(x: Tute) {
    setEditing(x.id);
    setForm({ batchId: x.batchId, title: x.title, description: x.description ?? '', url: x.url });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(id: string) {
    try {
      await api(`/tenants/${tenantId}/tutes/${id}`, { method: 'DELETE' });
      if (editing === id) {
        setEditing(null);
        setForm((f) => ({ ...EMPTY, batchId: f.batchId }));
      }
      load();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  if (tutes === null) return error ? <FormError message={error} /> : <Skeleton />;
  if (classes.length === 0 && tutes.length === 0) {
    return <EmptyState icon={FileText}>{tt.noClasses}</EmptyState>;
  }
  const shown = filter ? tutes.filter((x) => x.batchId === filter) : tutes;

  return (
    <>
      <form onSubmit={onSubmit} className={`${card} grid gap-4 p-5 sm:grid-cols-2`}>
        <h2 className="font-medium sm:col-span-2">{editing ? tt.edit : tt.add}</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-muted">{tt.class}</span>
          <select
            value={form.batchId}
            onChange={set('batchId')}
            required
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5"
          >
            {classes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.subjectName})
              </option>
            ))}
          </select>
        </label>
        <Field
          label={tt.name}
          value={form.title}
          onChange={set('title')}
          required
          maxLength={200}
        />
        <div className="sm:col-span-2">
          <Field
            label={tt.url}
            hint={tt.urlHint}
            type="url"
            pattern="https://.*"
            placeholder="https://drive.google.com/…"
            value={form.url}
            onChange={set('url')}
            required
            maxLength={1000}
          />
        </div>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink-muted">{tt.description}</span>
          <textarea
            rows={3}
            maxLength={5000}
            value={form.description}
            onChange={set('description')}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
          />
        </label>
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button type="submit" busy={busy} icon={editing ? Save : Plus} full={false}>
            {editing ? tt.save : tt.add}
          </Button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm((f) => ({ ...EMPTY, batchId: f.batchId }));
              }}
              className={btn('secondary', 'md')}
            >
              {tt.cancel}
            </button>
          )}
        </div>
      </form>

      {classes.length > 1 && (
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={tt.class}
          className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        >
          <option value="">{tt.all}</option>
          {classes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={FileText}>{tt.empty}</EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((x) => (
            <li key={x.id} className={`${card} flex flex-col gap-2 p-4`}>
              <TuteHeader tute={x} />
              <div className="mt-auto flex flex-wrap items-center gap-4 pt-1 text-sm">
                <a href={x.url} target="_blank" rel="noreferrer" className={btn('link', 'none')}>
                  <ExternalLink aria-hidden className="size-4" />
                  {tt.open}
                </a>
                <button type="button" onClick={() => edit(x)} className={btn('link', 'none')}>
                  <Pencil aria-hidden className="size-4" />
                  {tt.edit}
                </button>
                <ConfirmButton icon={Trash2} onConfirm={() => remove(x.id)}>
                  {tt.delete}
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TuteHeader({ tute }: { tute: Tute }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <FileText aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-medium">{tute.title}</h3>
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
            <Badge tone="primary">{tute.batchName}</Badge>
            {colomboDate(tute.createdAt)}
          </p>
        </div>
      </div>
      {tute.description && (
        <p className="text-sm whitespace-pre-line text-ink-muted">{tute.description}</p>
      )}
    </>
  );
}

function PortalTutes() {
  const { t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tutes, setTutes] = useState<Tute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ tutes: Tute[] }>(`/tenants/${tenantId}/portal/tutes`)
      .then((r) => setTutes(r.tutes))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, t]);

  if (error) return <FormError message={error} />;
  if (tutes === null) return <Skeleton />;
  if (tutes.length === 0) return <EmptyState icon={FileText}>{t.tutes.emptyPortal}</EmptyState>;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {tutes.map((x) => (
        <li key={x.id} className={`${card} flex flex-col gap-2 p-4`}>
          <TuteHeader tute={x} />
          <a
            href={x.url}
            target="_blank"
            rel="noreferrer"
            className={`mt-auto self-start ${btn('primary', 'sm')}`}
          >
            <Download aria-hidden className="size-4" />
            {t.tutes.download}
          </a>
        </li>
      ))}
    </ul>
  );
}
