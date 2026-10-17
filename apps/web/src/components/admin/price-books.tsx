'use client';

import { Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { Badge, Button, card, ConfirmButton, Field, FormError, Skeleton, useToast } from '../ui';
import { keyKind, parseValue, type PriceBook } from './shared';

type Draft = Record<string, string>;

/** Book values → text boxes. A missing feature shows as off and a missing cap as no limit. */
const toDraft = (keys: string[], values: Record<string, unknown>): Draft =>
  Object.fromEntries(
    keys.map((k) => {
      const v = values[k];
      return [k, keyKind(k) === 'feature' ? String(v === true) : v == null ? '' : String(v)];
    }),
  );

/** Text boxes → book values. An empty price, allowance or minimum is left out (= 0). */
const fromDraft = (draft: Draft) =>
  Object.fromEntries(
    Object.entries(draft)
      .filter(([k, v]) => keyKind(k) !== 'number' || v.trim() !== '')
      .map(([k, v]) => [k, parseValue(k, v)]),
  );

/** Books × keys grid. Saving shows how many accounts the change reaches first. */
export function PriceBooks() {
  const { t } = useI18n();
  const p = t.admin.priceBooks;
  const d = t.admin.detail;
  const toast = useToast();
  const [books, setBooks] = useState<PriceBook[] | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newBook, setNewBook] = useState({ key: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => setError(errorMessage(t, err)), [t]);
  const load = useCallback(() => {
    api<{ priceBooks: PriceBook[]; keys: string[] }>('/admin/price-books')
      .then((r) => {
        setBooks(r.priceBooks);
        setKeys(r.keys);
        setDrafts(Object.fromEntries(r.priceBooks.map((b) => [b.key, toDraft(r.keys, b.values)])));
      })
      .catch(fail);
  }, [fail]);
  useEffect(load, [load]);

  async function save(book: PriceBook) {
    setError(null);
    try {
      const res = await api<{ affectedAccounts: number }>(`/admin/price-books/${book.key}`, {
        method: 'PUT',
        body: { values: fromDraft(drafts[book.key]!) },
      });
      toast(fmt(p.saved, { count: res.affectedAccounts }));
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // A new book starts as a copy of the default one.
    const base = books?.find((b) => b.isDefault)?.values ?? {};
    try {
      await api('/admin/price-books', { method: 'POST', body: { ...newBook, values: base } });
      setNewBook({ key: '', name: '' });
      load();
    } catch (err) {
      fail(err);
    }
  }

  const set = (book: string, key: string, value: string) =>
    setDrafts((all) => ({ ...all, [book]: { ...all[book]!, [key]: value } }));
  const cell = 'rounded border border-line-strong bg-surface px-2 py-1 text-sm';

  if (!books) return error ? <FormError message={error} /> : <Skeleton />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      <p className="max-w-2xl text-sm text-ink-muted">{p.help}</p>
      <FormError message={error} />
      <div className={`${card} overflow-x-auto`}>
        <table className="text-sm">
          <thead className="bg-surface-soft text-left text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{d.key}</th>
              {books.map((b) => (
                <th key={b.key} className="px-3 py-2 align-top font-medium">
                  <span className="block text-ink">{b.name}</span>
                  <code className="text-xs">{b.key}</code>
                  <span className="block text-xs font-normal">
                    {fmt(p.accounts, { count: b.accounts })}
                  </span>
                  {b.isDefault && <Badge tone="primary">{p.isDefault}</Badge>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.map((key) => (
              <tr key={key}>
                <td className="px-3 py-1.5">
                  <code>{key}</code>
                </td>
                {books.map((b) => {
                  const value = drafts[b.key]?.[key] ?? '';
                  return (
                    <td key={b.key} className="px-3 py-1.5">
                      {keyKind(key) === 'feature' ? (
                        <select
                          aria-label={`${b.key} ${key}`}
                          value={value}
                          onChange={(e) => set(b.key, key, e.target.value)}
                          className={cell}
                        >
                          <option value="true">{d.on}</option>
                          <option value="false">{d.off}</option>
                        </select>
                      ) : (
                        <input
                          aria-label={`${b.key} ${key}`}
                          inputMode="decimal"
                          placeholder={keyKind(key) === 'cap' ? d.unlimited : '0'}
                          value={value}
                          onChange={(e) => set(b.key, key, e.target.value)}
                          className={`${cell} w-24`}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {books.map((b) => (
                <td key={b.key} className="px-3 py-2">
                  <ConfirmButton
                    icon={Save}
                    confirmLabel={fmt(p.confirm, { count: b.accounts })}
                    onConfirm={() => save(b)}
                  >
                    {fmt(p.save, { name: b.name })}
                  </ConfirmButton>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className={`${card} max-w-md space-y-3 p-4`}>
        <h2 className="font-medium">{p.new}</h2>
        <Field
          label={p.key}
          required
          pattern="[a-z0-9_\-]{2,32}"
          value={newBook.key}
          onChange={(e) => setNewBook({ ...newBook, key: e.target.value })}
        />
        <Field
          label={p.name}
          required
          maxLength={100}
          value={newBook.name}
          onChange={(e) => setNewBook({ ...newBook, name: e.target.value })}
        />
        <Button full={false} icon={Plus}>
          {p.create}
        </Button>
      </form>
    </div>
  );
}
