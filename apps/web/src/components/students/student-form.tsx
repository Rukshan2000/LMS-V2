'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage, fmt } from '@/lib/api';
import { Button, Field, FormError } from '../ui';
import { displayPhone, type Guardian, type Relationship, type Student } from './types';

const emptyGuardian: Guardian = { fullName: '', phone: '', relationship: 'mother' };

interface Duplicate {
  id: string;
  studentNumber: string;
  fullName: string;
}

/** Create (no `student`) or edit an existing student. */
export function StudentForm({ student }: { student?: Student }) {
  const { lang, t } = useI18n();
  const s = t.students;
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const base = `/${lang}/t/${tenantId}/students`;

  const [form, setForm] = useState({
    fullName: student?.fullName ?? '',
    phone: displayPhone(student?.phone),
    grade: student?.grade ?? '',
    school: student?.school ?? '',
    notes: student?.notes ?? '',
    status: student?.status ?? 'active',
  });
  const [guardians, setGuardians] = useState<Guardian[]>(
    student?.guardians.length
      ? student.guardians.map((g) => ({ ...g, phone: displayPhone(g.phone) }))
      : [emptyGuardian],
  );
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const setGuardian = (i: number, key: keyof Guardian, value: string) =>
    setGuardians((gs) => gs.map((g, j) => (j === i ? { ...g, [key]: value } : g)));

  async function save(allowDuplicate = false) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      ...form,
      // A guardian row left completely empty is not sent.
      guardians: guardians.filter((g) => g.fullName.trim() || g.phone.trim()),
      ...(student ? {} : { allowDuplicate }),
    };
    try {
      if (student) {
        await api(`/tenants/${tenantId}/students/${student.id}`, { method: 'PATCH', body });
        setSaved(true);
        setBusy(false);
      } else {
        const res = await api<{ student: Student }>(`/tenants/${tenantId}/students`, {
          method: 'POST',
          body,
        });
        router.replace(`${base}/${res.student.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'possible_duplicate') {
        setDuplicate((err.details as { existing: Duplicate }).existing);
      } else {
        setError(errorMessage(t, err));
      }
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6">
      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <Field
          label={s.name}
          value={form.fullName}
          onChange={set('fullName')}
          required
          maxLength={200}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={s.grade}
            value={form.grade}
            onChange={set('grade')}
            maxLength={50}
            placeholder="2027 A/L"
          />
          <Field label={s.school} value={form.school} onChange={set('school')} maxLength={200} />
        </div>
        <Field
          label={s.phone}
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          placeholder="077 123 4567"
        />
      </div>

      <fieldset className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <legend className="px-1 font-medium">{s.guardian}</legend>
        {guardians.map((g, i) => (
          <div key={i} className="space-y-3 border-b border-zinc-100 pb-4 last:border-0 last:pb-0">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={s.guardianName}
                value={g.fullName}
                onChange={(e) => setGuardian(i, 'fullName', e.target.value)}
                maxLength={200}
              />
              <Field
                label={s.guardianPhone}
                type="tel"
                value={g.phone}
                onChange={(e) => setGuardian(i, 'phone', e.target.value)}
                placeholder="077 123 4567"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-700">
                {s.relationship}{' '}
                <select
                  value={g.relationship}
                  onChange={(e) => setGuardian(i, 'relationship', e.target.value as Relationship)}
                  className="ml-1 rounded-md border border-zinc-300 bg-white px-2 py-1"
                >
                  <option value="mother">{s.mother}</option>
                  <option value="father">{s.father}</option>
                  <option value="guardian">{s.guardianRel}</option>
                </select>
              </label>
              {guardians.length > 1 && (
                <button
                  type="button"
                  onClick={() => setGuardians((gs) => gs.filter((_, j) => j !== i))}
                  className="ml-auto text-sm text-red-600"
                >
                  {s.removeGuardian}
                </button>
              )}
            </div>
          </div>
        ))}
        {guardians.length < 2 && (
          <button
            type="button"
            onClick={() =>
              setGuardians((gs) => [...gs, { ...emptyGuardian, relationship: 'father' }])
            }
            className="text-sm font-medium text-indigo-600"
          >
            {s.addGuardian}
          </button>
        )}
      </fieldset>

      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">{s.notes}</span>
          <textarea
            value={form.notes}
            onChange={set('notes')}
            maxLength={2000}
            rows={3}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        {student && (
          <label className="block text-sm text-zinc-700">
            {s.status}{' '}
            <select
              value={form.status}
              onChange={set('status')}
              className="ml-1 rounded-md border border-zinc-300 bg-white px-2 py-1"
            >
              <option value="active">{s.active}</option>
              <option value="inactive">{s.inactive}</option>
            </select>
          </label>
        )}
      </div>

      {duplicate && (
        <div role="alert" className="space-y-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          <p>{fmt(s.duplicate, { name: duplicate.fullName, number: duplicate.studentNumber })}</p>
          <div className="flex gap-3">
            <Link href={`${base}/${duplicate.id}`} className="font-medium underline">
              {s.openExisting}
            </Link>
            <button type="button" onClick={() => save(true)} className="font-medium underline">
              {s.addAnyway}
            </button>
          </div>
        </div>
      )}
      <FormError message={error} />
      {saved && (
        <p role="status" className="text-sm text-green-700">
          {s.saved}
        </p>
      )}
      <div className="max-w-40">
        <Button type="submit" busy={busy}>
          {s.save}
        </Button>
      </div>
    </form>
  );
}
