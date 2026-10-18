'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import type { AccountState } from '@/lib/entitlements';
import { Badge, card, type Tone } from '../ui';

// Shapes of the /api/v1/admin responses (apps/api/src/modules/billing/service.ts).

export const HEADS = ['student', 'teacher', 'parent', 'admin', 'receptionist'] as const;
export type Head = (typeof HEADS)[number];

export interface AccountSummary {
  id: string;
  name: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  ownerName: string | null;
  claimed: boolean;
  priceBook: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  state: AccountState;
  daysLeft: number | null;
  amountDue: string;
  overdueInvoice: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  accountId: string;
  accountName?: string;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  number: string;
  period: string;
  total: string;
  paid: string;
  status: 'open' | 'paid' | 'void';
  dueDate: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  accountId: string | null;
  accountName: string | null;
  actor: string;
}

export interface PriceBook {
  key: string;
  name: string;
  values: Record<string, unknown>;
  isDefault: boolean;
  accounts: number;
}

const STATE_TONE: Record<AccountState, Tone> = {
  trial: 'primary',
  active: 'success',
  overdue: 'warning',
  restricted: 'danger',
  suspended: 'danger',
};

export function StateBadge({ state }: { state: AccountState }) {
  const { t } = useI18n();
  return <Badge tone={STATE_TONE[state]}>{t.admin.states[state]}</Badge>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className="bg-surface-soft text-left text-ink-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr:hover]:bg-surface-soft/60">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, num }: { children: ReactNode; num?: boolean }) => (
  <td className={`px-3 py-2 align-top ${num ? 'text-right font-mono whitespace-nowrap' : ''}`}>
    {children}
  </td>
);

/** Catalogue key → kind of input. Mirrors apps/api/src/modules/billing/catalogue.ts. */
export const keyKind = (key: string) =>
  key.startsWith('feature.') ? 'feature' : key.startsWith('cap.') ? 'cap' : 'number';

/** Text box value → JSON value for a key ('' cap = no limit). */
export function parseValue(key: string, raw: string): unknown {
  const kind = keyKind(key);
  if (kind === 'feature') return raw === 'true';
  if (kind === 'cap' && raw.trim() === '') return null;
  return Number(raw);
}

export const showValue = (value: unknown, t: { on: string; off: string; unlimited: string }) =>
  value === true ? t.on : value === false ? t.off : value === null ? t.unlimited : String(value);

/** Compact "S 120 · T 4 · P 30" style head counts, zero heads left out. */
export function HeadCounts({ counts }: { counts: Record<Head, number> }) {
  const { t } = useI18n();
  const parts = HEADS.filter((h) => counts[h] > 0);
  if (!parts.length) return <span className="text-ink-subtle">0</span>;
  return (
    <span className="whitespace-nowrap">
      {parts.map((h) => `${t.admin.heads[h]} ${counts[h]}`).join(' · ')}
    </span>
  );
}
