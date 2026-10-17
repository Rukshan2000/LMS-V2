'use client';

import { Plus, Save, TriangleAlert, UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, ApiError, errorMessage, fmt } from '@/lib/api';
import { btn, Button, card, Field, FormError, useToast } from '../ui';
import { displayPhone, type Guardian, type Relationship, type Student } from './types';

const emptyGuardian: Guardian = { fullName: '', phone: '', email: '', relationship: 'mother' };

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
    email: student?.email ?? '',
    grade: student?.grade ?? '',
    school: student?.school ?? '',
    notes: student?.notes ?? '',
    status: student?.status ?? 'active',
  });
  const [guardians, setGuardians] = useState<Guardian[]>(
    student?.guardians.length
      ? student.guardians.map((g) => ({ ...g, phone: displayPhone(g.phone), email: g.email ?? '' }))
      : [emptyGuardian],
  );
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const setGuardian = (i: number, key: keyof Guardian, value: string) =>
    setGuardians((gs) => gs.map((g, j) => (j === i ? { ...g, [key]: value } : g)));

  async function save(allowDuplicate = false) {
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      // A guardian row left completely empty is not sent.
      guardians: guardians.filter((g) => g.fullName.trim() || g.phone.trim()),
      ...(student ? {} : { allowDuplicate }),
    };
    try {
      if (student) {
        await api(`/tenants/${tenantId}/students/${student.id}`, { method: 'PATCH', body });
        toast(s.saved);
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
    <form onSubmit={onSubmit} className="space-y-6">
      <div className={`${card} space-y-4 p-4`}>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={s.phone}
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="077 123 4567"
          />
          <Field
            label={s.email}
            type="email"
            value={form.email}
            onChange={set('email')}
            maxLength={254}
          />
        </div>
      </div>

      <fieldset className={`${card} space-y-4 p-4`}>
        <legend className="px-1 font-medium">{s.guardian}</legend>
        {guardians.map((g, i) => (
          <div key={i} className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
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
              <Field
                label={s.guardianEmail}
                type="email"
                value={g.email ?? ''}
                onChange={(e) => setGuardian(i, 'email', e.target.value)}
                maxLength={254}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-ink-muted">
                {s.relationship}{' '}
                <select
                  value={g.relationship}
                  onChange={(e) => setGuardian(i, 'relationship', e.target.value as Relationship)}
                  className="ml-1 rounded-lg border border-line-strong bg-surface px-2 py-1"
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
                  className={`ml-auto text-sm ${btn('linkDanger', 'none')}`}
                >
                  <UserMinus aria-hidden className="size-4" />
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
            className={`text-sm ${btn('link', 'none')}`}
          >
            <Plus aria-hidden className="size-4" />
            {s.addGuardian}
          </button>
        )}
      </fieldset>

      <div className={`${card} space-y-4 p-4`}>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-muted">{s.notes}</span>
          <textarea
            value={form.notes}
            onChange={set('notes')}
            maxLength={2000}
            rows={3}
            className="w-full rounded-lg border border-line-strong px-3 py-2"
          />
        </label>
        {student && (
          <label className="block text-sm text-ink-muted">
            {s.status}{' '}
            <select
              value={form.status}
              onChange={set('status')}
              className="ml-1 rounded-lg border border-line-strong bg-surface px-2 py-1"
            >
              <option value="active">{s.active}</option>
              <option value="inactive">{s.inactive}</option>
            </select>
          </label>
        )}
      </div>

      {duplicate && (
        <div
          role="alert"
          className="animate-fade-in space-y-3 rounded-lg bg-warning-soft p-4 text-sm text-warning"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {fmt(s.duplicate, { name: duplicate.fullName, number: duplicate.studentNumber })}
          </p>
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
      <Button type="submit" busy={busy} full={false} icon={Save}>
        {s.save}
      </Button>
    </form>
  );
}
