import type { Dictionary } from '@/i18n/dictionaries/en';
import type { Role } from './api';
import type { Feature } from './entitlements';

export interface NavItem {
  key: keyof Dictionary['nav'];
  /** Path under /t/:tenantId. Items without a path are not built yet ("Soon"). */
  path?: string;
  roles: Role[];
  /** Plan feature the page needs; without it the item shows a lock and the page a <Locked> card. */
  feature?: Feature;
}

const STAFF: Role[] = ['owner', 'admin'];
/** Students and parents get their own view of these pages (the portal, one section each). */
const FAMILY: Role[] = ['student', 'parent'];

// v1 menu. Order = sidebar order. Add `path` when a feature ships.
export const NAV: NavItem[] = [
  {
    key: 'overview',
    path: '',
    roles: ['owner', 'admin', 'teacher', 'receptionist', 'student', 'parent'],
  },
  { key: 'scan', path: '/scan', roles: [...STAFF, 'receptionist'] },
  // Teachers join in slice 2 (they will see only their own batches' students).
  { key: 'students', path: '/students', roles: [...STAFF, 'receptionist'] },
  { key: 'classes', path: '/classes', roles: [...STAFF, 'receptionist', 'teacher'] },
  {
    key: 'attendance',
    path: '/attendance',
    roles: [...STAFF, 'receptionist', 'teacher', ...FAMILY],
  },
  { key: 'fees', path: '/fees', roles: [...STAFF, 'receptionist', ...FAMILY] },
  { key: 'slips', path: '/slips', roles: [...STAFF, 'receptionist'], feature: 'bank_slips' },
  {
    key: 'timetable',
    path: '/timetable',
    roles: [...STAFF, 'receptionist', 'teacher', ...FAMILY],
  },
  {
    key: 'quizzes',
    path: '/quizzes',
    roles: [...STAFF, 'teacher', ...FAMILY],
    feature: 'quizzes',
  },
  { key: 'tutes', path: '/tutes', roles: [...STAFF, 'teacher', ...FAMILY] },
  { key: 'reports', path: '/reports', roles: STAFF, feature: 'reports' },
  { key: 'billing', path: '/billing', roles: STAFF },
  { key: 'settings', path: '/settings', roles: STAFF },
];

export const navForRoles = (roles: Role[]): NavItem[] =>
  NAV.filter((item) => item.roles.some((r) => roles.includes(r)));
