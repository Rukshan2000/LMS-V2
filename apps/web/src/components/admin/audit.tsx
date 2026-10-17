'use client';

import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { colomboDate, colomboTime } from '@/lib/datetime';
import { EmptyState, FormError, Skeleton } from '../ui';
import { Table, Td, type AuditEvent } from './shared';

/** Changed fields only: "price.student: 100 → 80". Whole objects when there was no before. */
function change(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const show = (v: unknown) =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
  return keys
    .map((k) => (k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(a[k])}`))
    .join('; ');
}

export function AuditRows({ events, showAccount }: { events: AuditEvent[]; showAccount: boolean }) {
  const { lang, t } = useI18n();
  const a = t.admin.audit;
  if (!events.length) return <EmptyState icon={ScrollText}>{a.empty}</EmptyState>;
  const head = [a.when, a.who, ...(showAccount ? [a.account] : []), a.action, a.change];
  return (
    <Table head={head}>
      {events.map((e) => (
        <tr key={e.id}>
          <Td>
            <span className="font-mono whitespace-nowrap">
              {colomboDate(e.createdAt)} {colomboTime(e.createdAt)}
            </span>
          </Td>
          <Td>
            {e.actor}
            {e.ip && <span className="block text-xs text-ink-subtle">{e.ip}</span>}
          </Td>
          {showAccount && (
            <Td>
              {e.accountId ? (
                <Link
                  href={`/${lang}/admin/accounts/${e.accountId}`}
                  className="text-primary hover:text-primary-hover"
                >
                  {e.accountName}
                </Link>
              ) : (
                <span className="text-ink-subtle">{a.platform}</span>
              )}
            </Td>
          )}
          <Td>
            <code>{e.action}</code>
          </Td>
          <Td>
            <span className="block max-w-xl text-xs break-words">{change(e.before, e.after)}</span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function AuditPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api<{ events: AuditEvent[] }>('/admin/audit')
      .then((r) => setEvents(r.events))
      .catch((err) => setError(errorMessage(t, err)));
  }, [t]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t.admin.audit.title}</h1>
      <FormError message={error} />
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t.admin.audit.filter}
        aria-label={t.admin.audit.filter}
        className="w-full max-w-sm rounded-lg border border-line-strong bg-surface px-3 py-2"
      />
      {events ? (
        <AuditRows
          events={events.filter((e) =>
            [e.action, e.actor, e.accountName ?? '']
              .join(' ')
              .toLowerCase()
              .includes(filter.trim().toLowerCase()),
          )}
          showAccount
        />
      ) : (
        <Skeleton />
      )}
    </div>
  );
}
