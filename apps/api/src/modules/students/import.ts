import type { Knex } from 'knex';
import { parseCsv } from '../../lib/csv.js';
import { HttpError } from '../../lib/http-error.js';
import { assertStudentCapacity } from '../../lib/plans.js';
import {
  createStudent,
  findDuplicate,
  RELATIONSHIPS,
  studentInput,
  type StudentInput,
} from './service.js';

export const MAX_IMPORT_ROWS = 2000;

// Accepted header names (case/space-insensitive) → field.
const HEADERS: Record<string, keyof RowFields> = {
  name: 'fullName',
  fullname: 'fullName',
  studentname: 'fullName',
  phone: 'phone',
  studentphone: 'phone',
  school: 'school',
  grade: 'grade',
  notes: 'notes',
  guardianname: 'guardianName',
  parentname: 'guardianName',
  guardianphone: 'guardianPhone',
  parentphone: 'guardianPhone',
  relationship: 'relationship',
};
interface RowFields {
  fullName: string;
  phone: string;
  school: string;
  grade: string;
  notes: string;
  guardianName: string;
  guardianPhone: string;
  relationship: string;
}

export interface ImportIssue {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  field?: string;
  code: 'invalid' | 'duplicate_in_db' | 'duplicate_in_file' | 'plan_limit';
  message: string;
}

export interface ImportResult {
  total: number;
  ready: number;
  skipped: ImportIssue[];
  errors: ImportIssue[];
  created: number;
}

type Prepared = { line: number; input: StudentInput };

function toInput(fields: Partial<RowFields>) {
  const guardians =
    fields.guardianPhone || fields.guardianName
      ? [
          {
            fullName: fields.guardianName || fields.fullName || '',
            phone: fields.guardianPhone ?? '',
            relationship: (RELATIONSHIPS as readonly string[]).includes(
              (fields.relationship ?? '').toLowerCase(),
            )
              ? fields.relationship!.toLowerCase()
              : 'guardian',
          },
        ]
      : [];
  return studentInput.safeParse({
    fullName: fields.fullName ?? '',
    phone: fields.phone,
    school: fields.school,
    grade: fields.grade,
    notes: fields.notes,
    guardians,
  });
}

/**
 * Validate a CSV and, unless dryRun, create all ready rows in the caller's transaction.
 * Invalid rows block the whole import; duplicates are skipped and reported.
 */
export async function importStudents(
  trx: Knex.Transaction,
  tenantId: string,
  csv: string,
  dryRun: boolean,
): Promise<ImportResult> {
  const [header, ...rows] = parseCsv(csv);
  const result: ImportResult = {
    total: rows.length,
    ready: 0,
    skipped: [],
    errors: [],
    created: 0,
  };
  if (!header) {
    result.errors.push({ line: 1, code: 'invalid', message: 'empty_file' });
    return result;
  }
  const columns = header.map((h) => HEADERS[h.toLowerCase().replace(/[\s_-]/g, '')]);
  if (!columns.includes('fullName')) {
    result.errors.push({ line: 1, field: 'name', code: 'invalid', message: 'missing_name_column' });
    return result;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    result.errors.push({ line: 1, code: 'invalid', message: 'too_many_rows' });
    return result;
  }

  const prepared: Prepared[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const fields: Partial<RowFields> = {};
    columns.forEach((col, c) => {
      if (col) fields[col] = row[c]?.trim() ?? '';
    });
    const parsed = toInput(fields);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.errors.push({
          line,
          field: issue.path.join('.'),
          code: 'invalid',
          message: issue.message,
        });
      }
      continue;
    }
    const input = parsed.data;
    const phones = [input.phone, ...input.guardians.map((g) => g.phone)].filter(Boolean);
    const keys = phones.map((p) => `${input.fullName.toLowerCase()}|${p}`);
    if (keys.some((k) => seen.has(k))) {
      result.skipped.push({ line, code: 'duplicate_in_file', message: input.fullName });
      continue;
    }
    keys.forEach((k) => seen.add(k));
    if (await findDuplicate(trx, input)) {
      result.skipped.push({ line, code: 'duplicate_in_db', message: input.fullName });
      continue;
    }
    prepared.push({ line, input });
  }
  result.ready = prepared.length;
  try {
    await assertStudentCapacity(trx, tenantId, prepared.length);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    const { limit, active } = err.details as { limit: number; active: number };
    result.errors.push({ line: 1, code: 'plan_limit', message: `${active}/${limit}` });
  }

  if (!dryRun && result.errors.length === 0) {
    for (const { input } of prepared) await createStudent(trx, tenantId, input);
    result.created = prepared.length;
  }
  return result;
}
