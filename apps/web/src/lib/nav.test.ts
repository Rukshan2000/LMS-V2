import { describe, expect, it } from 'vitest';
import { navForRoles } from './nav';

const keys = (roles: Parameters<typeof navForRoles>[0]) => navForRoles(roles).map((i) => i.key);

describe('navForRoles', () => {
  it('owner sees management items including settings', () => {
    expect(keys(['owner'])).toEqual(expect.arrayContaining(['students', 'slips', 'settings']));
  });

  it('student sees only their own areas', () => {
    expect(keys(['student'])).toEqual([
      'overview',
      'attendance',
      'fees',
      'timetable',
      'liveClasses',
    ]);
  });

  it('receptionist cannot see reports or settings', () => {
    expect(keys(['receptionist'])).not.toContain('reports');
    expect(keys(['receptionist'])).not.toContain('settings');
  });

  it('multiple roles combine without duplicates', () => {
    const k = keys(['teacher', 'receptionist']);
    expect(new Set(k).size).toBe(k.length);
    expect(k).toContain('scan');
    expect(k).toContain('classes');
  });

  it('timetable is a link for teachers but "Soon" for students until the portal exists', () => {
    expect(navForRoles(['teacher']).find((i) => i.key === 'timetable')?.path).toBe('/timetable');
    expect(navForRoles(['student']).find((i) => i.key === 'timetable')?.path).toBeUndefined();
  });

  it('no roles → nothing', () => {
    expect(keys([])).toEqual([]);
  });
});
