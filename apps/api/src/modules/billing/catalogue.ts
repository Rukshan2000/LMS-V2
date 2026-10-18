import { z } from 'zod';

// What can be priced, capped or switched (docs/SAAS_PLAN.md §5.3). Keys live in code because
// code enforces them; the values per price book / account live in the database.

/** Billable heads. Students are student records; the others are active memberships by role. */
export const HEADS = ['student', 'teacher', 'parent', 'admin', 'receptionist'] as const;
export type Head = (typeof HEADS)[number];

export const CAPS = ['students', 'teachers', 'parents', 'institutes'] as const;
export type Cap = (typeof CAPS)[number];
/** Head counted by each cap (institutes are counted separately). */
export const CAP_HEAD: Record<Exclude<Cap, 'institutes'>, Head> = {
  students: 'student',
  teachers: 'teacher',
  parents: 'parent',
};

export const FEATURES = [
  'bank_slips',
  'live_links',
  'reports',
  'student_import',
  'portal',
  'quizzes',
] as const;
export type Feature = (typeof FEATURES)[number];

// LKR with at most 2 decimals, so invoices can convert it to integer cents exactly.
const money = z
  .number()
  .min(0)
  .max(10_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'max 2 decimals');
const count = z.number().int().min(0).max(1_000_000);

/** Every key with its schema. A price book or override may hold any subset. */
const shape = {
  ...Object.fromEntries(HEADS.map((h) => [`price.${h}`, money])),
  ...Object.fromEntries(HEADS.map((h) => [`included.${h}`, count])),
  'minimum.monthly': money,
  // null = no cap.
  ...Object.fromEntries(CAPS.map((c) => [`cap.${c}`, count.nullable()])),
  ...Object.fromEntries(FEATURES.map((f) => [`feature.${f}`, z.boolean()])),
} as Record<string, z.ZodType>;

export const KEYS = Object.keys(shape);
export type Key = (typeof KEYS)[number];

/** Validates price book values and overrides written by the platform admin: no unknown keys. */
export const valuesSchema = z.strictObject(shape).partial();
/** Validates one override value. */
export const keyValue = (key: string) => {
  const schema = shape[key];
  if (!schema) throw new Error(`Unknown billing key: ${key}`);
  return schema;
};

/** Fully resolved values: every key present. */
export interface Values {
  price: Record<Head, number>;
  included: Record<Head, number>;
  minimumMonthly: number;
  caps: Record<Cap, number | null>;
  features: Record<Feature, boolean>;
}

/**
 * Value when a key is missing from both book and overrides: nothing charged, no cap, feature
 * off. Keys can then be added to the catalogue before or after the data migration that sets them.
 */
export const defaults = (): Values => ({
  price: Object.fromEntries(HEADS.map((h) => [h, 0])) as Values['price'],
  included: Object.fromEntries(HEADS.map((h) => [h, 0])) as Values['included'],
  minimumMonthly: 0,
  caps: Object.fromEntries(CAPS.map((c) => [c, null])) as Values['caps'],
  features: Object.fromEntries(FEATURES.map((f) => [f, false])) as Values['features'],
});
