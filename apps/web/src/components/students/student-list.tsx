'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { FormError } from '../ui';
import { displayPhone, type StudentRow } from './types';

export function StudentList() {
  const { lang, t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  const base = `/${lang}/t/${tenantId}/students`;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = (after?: string) => {
    const params = new URLSearchParams({ status: showInactive ? 'all' : 'active' });
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<{ students: StudentRow[]; nextCursor: string | null }>(
      `/tenants/${tenantId}/students?${params}`,
    );
  };

  useEffect(() => {
    let cancelled = false;
    // Wait for typing to pause before searching.
    const timer = setTimeout(() => {
      query()
        .then((res) => {
          if (cancelled) return;
          setRows(res.students);
          setCursor(res.nextCursor);
          setError(null);
        })
        .catch((err) => !cancelled && setError(errorMessage(t, err)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads q/showInactive
  }, [q, showInactive, tenantId]);

  async function loadMore() {
    if (!cursor) return;
    const res = await query(cursor);
    setRows((r) => [...(r ?? []), ...res.students]);
    setCursor(res.nextCursor);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{t.students.title}</h1>
        <Link
          href={`${base}/import`}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium"
        >
          {t.students.import}
        </Link>
        <Link
          href={`${base}/new`}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          {t.students.add}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.students.search}
          aria-label={t.students.search}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t.students.showInactive}
        </label>
      </div>

      <FormError message={error} />
      {rows === null ? (
        <p className="text-zinc-500">{t.loading}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
          {q ? t.students.noResults : t.students.empty}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`${base}/${s.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50"
              >
                <span className="w-14 shrink-0 font-mono text-sm text-zinc-500">
                  {s.studentNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.fullName}</span>
                  <span className="block truncate text-sm text-zinc-500">
                    {[s.grade, displayPhone(s.guardianPhone ?? s.phone)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {s.status === 'inactive' && (
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                    {t.students.inactive}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 text-sm"
        >
          {t.students.loadMore}
        </button>
      )}
    </div>
  );
}
