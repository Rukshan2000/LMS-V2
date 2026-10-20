'use client';

import { LayoutGrid, Plus, Rows3, Search, Upload, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { Table, Td } from '../admin/shared';
import { Badge, btn, card, EmptyState, FormError, Skeleton } from '../ui';
import { displayPhone, type StudentRow } from './types';

// Table or grid, remembered per browser. The server always renders the table.
const VIEW_KEY = 'students-view';
type View = 'table' | 'grid';
const viewListeners = new Set<() => void>();
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table';
  } catch {
    return 'table';
  }
};
function saveView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
  viewListeners.forEach((l) => l());
}
const subscribeView = (l: () => void) => {
  viewListeners.add(l);
  return () => viewListeners.delete(l);
};

export function StudentList() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const { tenantId } = useParams<{ tenantId: string }>();
  const base = `/${lang}/t/${tenantId}/students`;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useSyncExternalStore(subscribeView, readView, () => 'table' as const);

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
        <div className="flex rounded-lg border border-line-strong p-0.5">
          {(
            [
              ['table', Rows3, t.students.viewTable],
              ['grid', LayoutGrid, t.students.viewGrid],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => saveView(v)}
              aria-pressed={view === v}
              title={label}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                view === v ? 'bg-primary-soft text-primary-hover' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon aria-hidden className="size-4" />
              <span className="max-sm:sr-only">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <FormError message={error} />
      {rows === null ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={q ? Search : Users}>
          {q ? t.students.noResults : t.students.empty}
        </EmptyState>
      ) : view === 'table' ? (
        <Table
          head={[t.students.number, t.students.name, t.students.grade, t.students.guardianPhone]}
        >
          {rows.map((s) => (
            <tr
              key={s.id}
              onClick={() => router.push(`${base}/${s.id}`)}
              className="cursor-pointer"
            >
              <Td>
                <span className="font-mono text-ink-subtle">{s.studentNumber}</span>
              </Td>
              <Td>
                <Link
                  href={`${base}/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium hover:text-primary"
                >
                  {s.fullName}
                </Link>
                {s.status === 'inactive' && (
                  <span className="ml-2">
                    <Badge tone="neutral">{t.students.inactive}</Badge>
                  </span>
                )}
              </Td>
              <Td>{s.grade}</Td>
              <Td>
                <span className="whitespace-nowrap">
                  {displayPhone(s.guardianPhone ?? s.phone)}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`${base}/${s.id}`}
                className={`${card} flex h-full flex-col gap-3 p-4 transition-colors hover:border-primary-ring hover:bg-surface-soft`}
              >
                <span className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-hover">
                    {s.fullName.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.fullName}</span>
                    <span className="block font-mono text-xs text-ink-subtle">
                      {s.studentNumber}
                    </span>
                  </span>
                </span>
                <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-subtle">
                  {[s.grade, displayPhone(s.guardianPhone ?? s.phone)].filter(Boolean).join(' · ')}
                  {s.status === 'inactive' && <Badge tone="neutral">{t.students.inactive}</Badge>}
                </span>
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
