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
  features: Record<Feature, boolean>;
  /** `used` only for owners and admins. limit null = no limit. */
  caps: Record<Cap, { limit: number | null; used?: number }>;
}
