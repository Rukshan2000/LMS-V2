'use client';

import { BookOpen, QrCode, Smartphone, UserRound, Wallet } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { BackLink, FormError, Skeleton, Tabs } from '../ui';
import { useTenantData } from '../dashboard-shell';
import { StudentFees } from '../fees/student-fees';
import { StudentCard } from './student-card';
import { StudentClasses } from './student-classes';
import { Locked } from '../locked';
import { PortalInvite } from './portal-invite';
import { StudentForm } from './student-form';
import type { Student } from './types';

function Page({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { lang, t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  return (
    <div className="space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}/students`}>{t.students.back}</BackLink>
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
  const { roles } = useTenantData();
  const desk = roles.some((r) => r === 'owner' || r === 'admin' || r === 'receptionist');
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ student: Student }>(`/tenants/${tenantId}/students/${studentId}`)
      .then((res) => setStudent(res.student))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, studentId, t]);

  if (error) return <FormError message={error} />;
  if (!student) return <Skeleton />;
  return (
    <Page
      title={
        <>
          <span className="mr-2 rounded-lg bg-primary-soft px-2 py-0.5 align-middle font-mono text-base text-primary-hover">
            {student.studentNumber}
          </span>
          {student.fullName}
        </>
      }
    >
      <Tabs
        items={[
          {
            id: 'classes',
            icon: BookOpen,
            label: t.classes.inClasses,
            content: <StudentClasses studentId={student.id} initial={student.classes} />,
          },
          {
            id: 'fees',
            icon: Wallet,
            label: t.fees.title,
            content: <StudentFees studentId={student.id} classes={student.classes} />,
          },
          {
            id: 'card',
            icon: QrCode,
            label: t.students.cardTab,
            content: <StudentCard studentId={student.id} />,
          },
          desk &&
            student.status === 'active' && {
              id: 'portal',
              icon: Smartphone,
              label: t.portal.invite,
              content: (
                <Locked feature="portal">
                  <PortalInvite student={student} />
                </Locked>
              ),
            },
          {
            id: 'details',
            icon: UserRound,
            label: t.students.detailsTab,
            content: <StudentForm key={student.id} student={student} />,
          },
        ]}
      />
    </Page>
  );
}
