export type Relationship = 'mother' | 'father' | 'guardian';

export interface Guardian {
  id?: string;
  fullName: string;
  phone: string;
  relationship: Relationship;
}

export interface Student {
  id: string;
  studentNumber: string;
  fullName: string;
  phone: string | null;
  school: string | null;
  grade: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  guardians: Guardian[];
  classes: { id: string; name: string; subjectName: string }[];
}

export interface StudentRow {
  id: string;
  studentNumber: string;
  fullName: string;
  phone: string | null;
  grade: string | null;
  status: 'active' | 'inactive';
  guardianPhone: string | null;
}

/** 94771234567 → 077 123 4567 */
export const displayPhone = (p: string | null | undefined) =>
  p && /^94\d{9}$/.test(p) ? `0${p.slice(2, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : (p ?? '');
