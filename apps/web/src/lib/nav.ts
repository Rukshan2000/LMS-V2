import type { Dictionary } from '@/i18n/dictionaries/en';
import type { Role } from './api';

export interface NavItem {
  key: keyof Dictionary['nav'];
  /** Path under /t/:tenantId. Items without a path are not built yet ("Soon"). */
  path?: string;
  /** Roles the page works for today; other roles in `roles` still see it as "Soon". */
  pathRoles?: Role[];
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
  {
    key: 'attendance',
    path: '/attendance',
    pathRoles: [...STAFF, 'receptionist', 'teacher'],
    roles: [...STAFF, 'receptionist', 'teacher', 'student', 'parent'],
  },
  { key: 'fees', roles: [...STAFF, 'receptionist', 'student', 'parent'] },
  { key: 'slips', roles: [...STAFF, 'receptionist'] },
  {
    key: 'timetable',
    path: '/timetable',
    // Student/parent view arrives with the portal (slice 7).
    pathRoles: [...STAFF, 'receptionist', 'teacher'],
    roles: [...STAFF, 'receptionist', 'teacher', 'student', 'parent'],
  },
  { key: 'liveClasses', roles: ['student', 'parent'] },
  { key: 'reports', roles: STAFF },
  { key: 'settings', path: '/settings', roles: STAFF },
];

export const navForRoles = (roles: Role[]): NavItem[] =>
  NAV.filter((item) => item.roles.some((r) => roles.includes(r))).map((item) =>
    item.pathRoles && !item.pathRoles.some((r) => roles.includes(r))
      ? { ...item, path: undefined }
      : item,
  );
