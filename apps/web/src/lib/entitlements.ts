// Mirrors the API's GET /tenants/:tenantId `entitlements` (docs/SAAS_PLAN.md §7.6).

export type AccountState = 'trial' | 'active' | 'overdue' | 'restricted' | 'suspended';
export type Feature = 'bank_slips' | 'live_links' | 'reports' | 'student_import' | 'portal';
export type Cap = 'students' | 'teachers' | 'parents' | 'institutes';

export interface Entitlements {
  state: AccountState;
  trialEndsAt: string | null;
  daysLeft: number | null;
  writable: boolean;
  canAddHeads: boolean;
  /** LKR, e.g. "5000.00". */
  amountDue: string;
  /** Oldest unpaid invoice past its due date, and that date (YYYY-MM-DD). */
  overdueInvoice: string | null;
  overdueDueDate: string | null;
  features: Record<Feature, boolean>;
  /** `used` only for owners and admins. limit null = no limit. */
  caps: Record<Cap, { limit: number | null; used?: number }>;
}

export type Head = 'student' | 'teacher' | 'parent' | 'admin' | 'receptionist';

export type InvoiceLine =
  | {
      type: 'head';
      head: Head;
      peak: number;
      included: number;
      billable: number;
      unitPrice: string;
      amount: string;
    }
  | { type: 'minimum'; minimum: string; amount: string };

/** GET /tenants/:tenantId/billing (owner, admin). Money is LKR strings, e.g. "100.00". */
export interface Billing {
  prices: Record<Head, string>;
  included: Record<Head, number>;
  minimumMonthly: string;
  thisMonth: {
    period: string;
    headsNow: Record<Head, number>;
    lines: InvoiceLine[];
    total: string;
  };
  invoices: {
    id: string;
    number: string;
    period: string;
    total: string;
    paid: string;
    status: 'open' | 'paid';
    dueDate: string;
  }[];
  payTo: { bankDetails: string | null; whatsapp: string | null };
}
