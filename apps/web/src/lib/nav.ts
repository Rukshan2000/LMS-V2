import type { Dictionary } from '@/i18n/dictionaries/en';
import type { Role } from './api';

export interface NavItem {
  key: keyof Dictionary['nav'];
  /** Path under /t/:tenantId. Items without a path are not built yet ("Soon"). */
  path?: string;
  roles: Role[];
}

const STAFF: Role[] = ['owner', 'admin'];

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
  // Parents and students see classes, attendance and fees on their overview (portal).
  { key: 'attendance', path: '/attendance', roles: [...STAFF, 'receptionist', 'teacher'] },
  { key: 'fees', path: '/fees', roles: [...STAFF, 'receptionist'] },
  { key: 'slips', path: '/slips', roles: [...STAFF, 'receptionist'] },
  { key: 'timetable', path: '/timetable', roles: [...STAFF, 'receptionist', 'teacher'] },
  { key: 'reports', path: '/reports', roles: STAFF },
  { key: 'settings', path: '/settings', roles: STAFF },
];

export const navForRoles = (roles: Role[]): NavItem[] =>
  NAV.filter((item) => item.roles.some((r) => roles.includes(r)));
