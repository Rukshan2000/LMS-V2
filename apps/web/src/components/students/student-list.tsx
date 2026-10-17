'use client';

import { ChevronRight, Plus, Search, Upload, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { Badge, btn, card, EmptyState, FormError, Skeleton } from '../ui';
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
        <Link href={`${base}/import`} className={btn('secondary', 'md')}>
          <Upload aria-hidden className="size-4" />
          {t.students.import}
        </Link>
        <Link href={`${base}/new`} className={btn('primary', 'md')}>
          <Plus aria-hidden className="size-4" />
          {t.students.add}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.students.search}
            aria-label={t.students.search}
            className="w-full rounded-lg border border-line-strong py-2.5 pr-3 pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
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
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={q ? Search : Users}>
          {q ? t.students.noResults : t.students.empty}
        </EmptyState>
      ) : (
        <ul className={`${card} divide-y divide-line overflow-hidden`}>
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`${base}/${s.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-soft"
              >
                <span className="w-14 shrink-0 font-mono text-sm text-ink-subtle">
                  {s.studentNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.fullName}</span>
                  <span className="block truncate text-sm text-ink-subtle">
                    {[s.grade, displayPhone(s.guardianPhone ?? s.phone)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {s.status === 'inactive' && <Badge tone="neutral">{t.students.inactive}</Badge>}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" onClick={loadMore} className={btn('secondary', 'md', true)}>
          {t.students.loadMore}
        </button>
      )}
    </div>
  );
}
