'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { FormError } from '../ui';
import { StudentForm } from './student-form';
import type { Student } from './types';

function Page({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { lang, t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  return (
    <div className="space-y-4">
      <Link href={`/${lang}/t/${tenantId}/students`} className="text-sm text-indigo-600">
        {t.students.back}
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function NewStudent() {
  const { t } = useI18n();
  return (
    <Page title={t.students.add}>
      <StudentForm />
    </Page>
  );
}

export function StudentDetail() {
  const { t } = useI18n();
  const { tenantId, studentId } = useParams<{ tenantId: string; studentId: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ student: Student }>(`/tenants/${tenantId}/students/${studentId}`)
      .then((res) => setStudent(res.student))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, studentId, t]);

  if (error) return <FormError message={error} />;
  if (!student) return <p className="text-zinc-500">{t.loading}</p>;
  return (
    <Page
      title={
        <>
          <span className="mr-2 font-mono text-base text-zinc-500">{student.studentNumber}</span>
          {student.fullName}
        </>
      }
    >
      <StudentForm key={student.id} student={student} />
    </Page>
  );
}
