import type { Knex } from 'knex';
import { z } from 'zod';
import { emailSchema } from '../../lib/email.js';
import { parsePhone } from '../../lib/phone.js';

export const RELATIONSHIPS = ['mother', 'father', 'guardian'] as const;

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = parsePhone(v);
    if (!p) ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    return p ?? '';
  });
const optionalEmail = z
  .union([emailSchema, z.literal('')])
  .nullish()
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const guardianInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone,
  // For portal invites by email.
  email: optionalEmail,
  relationship: z.enum(RELATIONSHIPS).default('guardian'),
});

export const studentInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z
    .union([phone, z.literal('')])
    .nullish()
    .transform((v) => v || null),
  email: optionalEmail,
  school: optionalText(200),
  grade: optionalText(50),
  notes: optionalText(2000),
  guardians: z.array(guardianInput).max(2).default([]),
});
export type StudentInput = z.output<typeof studentInput>;

/** Next value of a per-tenant counter, atomically (first call returns start + 1). */
export async function nextCounter(
  trx: Knex.Transaction,
  tenantId: string,
  key: string,
  start: number,
) {
  const { rows } = await trx.raw(
    `INSERT INTO tenant_counters (tenant_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
     RETURNING value`,
    [tenantId, key, start + 1],
  );
  return Number(rows[0].value);
}

/**
 * Same name (case-insensitive) and a shared phone (student's or any guardian's).
 * With no phone at all, the name alone counts: re-importing a sheet must not double everyone.
 */
export async function findDuplicate(
  trx: Knex.Transaction,
  input: Pick<StudentInput, 'fullName' | 'phone' | 'guardians'>,
  excludeId?: string,
) {
  const phones = [input.phone, ...input.guardians.map((g) => g.phone)].filter(Boolean) as string[];
  return trx('students as s')
    .whereRaw('lower(s.full_name) = lower(?)', [input.fullName])
    .modify((q) => {
      if (excludeId) q.whereNot('s.id', excludeId);
    })
    .modify((q) => {
      if (phones.length === 0) return;
      q.where((w) =>
        w
          .whereIn('s.phone', phones)
          .orWhereExists((sub) =>
            sub
              .select(trx.raw('1'))
              .from('student_guardians as sg')
              .join('guardians as g', 'g.id', 'sg.guardian_id')
              .whereRaw('sg.student_id = s.id')
              .whereIn('g.phone', phones),
          ),
      );
    })
    .first('s.id', 's.student_number as studentNumber', 's.full_name as fullName');
}

/** Link guardians to a student, reusing an existing guardian with the same phone (siblings). */
export async function setGuardians(
  trx: Knex.Transaction,
  tenantId: string,
  studentId: string,
  guardians: StudentInput['guardians'],
) {
  await trx('student_guardians').where({ student_id: studentId }).delete();
  for (const g of guardians) {
    const [row] = await trx('guardians')
      .insert({ tenant_id: tenantId, full_name: g.fullName, phone: g.phone, email: g.email })
      .onConflict(['tenant_id', 'phone'])
      // A sibling's form without the email must not erase it.
      .merge({
        email: trx.raw('COALESCE(EXCLUDED.email, guardians.email)'),
        updated_at: trx.fn.now(),
      })
      .returning('id');
    await trx('student_guardians')
      .insert({
        tenant_id: tenantId,
        student_id: studentId,
        guardian_id: row.id,
        relationship: g.relationship,
      })
      .onConflict(['student_id', 'guardian_id'])
      .ignore();
  }
}

export async function createStudent(trx: Knex.Transaction, tenantId: string, input: StudentInput) {
  const number = await nextCounter(trx, tenantId, 'student_number', 1000);
  const [student] = await trx('students')
    .insert({
      tenant_id: tenantId,
      student_number: String(number),
      full_name: input.fullName,
      phone: input.phone,
      email: input.email,
      school: input.school,
      grade: input.grade,
      notes: input.notes,
    })
    .returning(['id', 'student_number']);
  await setGuardians(trx, tenantId, student.id, input.guardians);
  return { id: student.id as string, studentNumber: student.student_number as string };
}

export async function getStudent(trx: Knex.Transaction, id: string) {
  const student = await trx('students')
    .where({ id })
    .first(
      'id',
      'student_number as studentNumber',
      'full_name as fullName',
      'phone',
      'email',
      'school',
      'grade',
      'status',
      'notes',
      'created_at as createdAt',
    );
  if (!student) return undefined;
  const guardians = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('sg.student_id', id)
    .orderBy('g.full_name')
    .select('g.id', 'g.full_name as fullName', 'g.phone', 'g.email', 'sg.relationship');
  const classes = await trx('enrollments as e')
    .join('batches as b', 'b.id', 'e.batch_id')
    .join('subjects as su', 'su.id', 'b.subject_id')
    .where({ 'e.student_id': id, 'e.status': 'active' })
    .orderBy('b.name')
    .select('b.id', 'b.name', 'su.name as subjectName');
  return { ...student, guardians, classes };
}
