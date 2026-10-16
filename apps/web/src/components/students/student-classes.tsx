'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import type { BatchSummary } from '../classes/types';
import { useTenantData } from '../dashboard-shell';
import { FormError } from '../ui';

interface StudentClass {
  id: string;
  name: string;
  subjectName: string;
}

/** Classes a student is in, with "Add to class" for desk staff. */
export function StudentClasses({
  studentId,
  initial,
}: {
  studentId: string;
  initial: StudentClass[];
}) {
  const { lang, t } = useI18n();
  const c = t.classes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const { roles } = useTenantData();
  const desk = roles.some((r) => r === 'owner' || r === 'admin' || r === 'receptionist');
  const [classes, setClasses] = useState(initial);
  const [all, setAll] = useState<BatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (desk)
      api<{ batches: BatchSummary[] }>(`/tenants/${tenantId}/batches`)
        .then((r) => setAll(r.batches))
        .catch(() => {});
  }, [desk, tenantId]);

  async function add(batchId: string) {
    try {
      await api(`/tenants/${tenantId}/batches/${batchId}/enrollments`, {
        method: 'POST',
        body: { studentIds: [studentId] },
      });
      const b = all.find((x) => x.id === batchId)!;
      setClasses((cs) => [...cs, { id: b.id, name: b.name, subjectName: b.subjectName }]);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  const available = all.filter((b) => !classes.some((x) => x.id === b.id));
  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="font-medium">{c.inClasses}</h2>
      <ul className="flex flex-wrap gap-2">
        {classes.map((b) => (
          <li key={b.id}>
            <Link
              href={`/${lang}/t/${tenantId}/classes/${b.id}`}
              className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700"
            >
              {b.name} · {b.subjectName}
            </Link>
          </li>
        ))}
      </ul>
      {desk && available.length > 0 && (
        <select
          value=""
          aria-label={c.addToClass}
          onChange={(e) => e.target.value && add(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">
            {c.addToClass}: {c.chooseClass}
          </option>
          {available.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.subjectName}
            </option>
          ))}
        </select>
      )}
      <FormError message={error} />
    </section>
  );
}
