'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage } from '@/lib/api';
import { BackLink, Button, card, Field, FormError } from '../ui';
import type { BatchDetail, Member } from './types';

export function ClassNew() {
  const { lang, t } = useI18n();
  const c = t.classes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({
    name: '',
    subject: '',
    teacherMembershipId: '',
    mode: 'physical',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ subjects: { id: string; name: string }[] }>(`/tenants/${tenantId}/subjects`)
      .then((r) => setSubjects(r.subjects))
      .catch(() => {});
    api<{ members: Member[] }>(`/tenants/${tenantId}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => {});
  }, [tenantId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const existing = subjects.find(
      (s) => s.name.toLowerCase() === form.subject.trim().toLowerCase(),
    );
    try {
      const { batch } = await api<{ batch: BatchDetail }>(`/tenants/${tenantId}/batches`, {
        method: 'POST',
        body: {
          name: form.name,
          ...(existing ? { subjectId: existing.id } : { subjectName: form.subject }),
          teacherMembershipId: form.teacherMembershipId || null,
          mode: form.mode,
        },
      });
      router.replace(`/${lang}/t/${tenantId}/classes/${batch.id}`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const teachers = members.filter((m) =>
    m.roles.some((r) => r === 'teacher' || r === 'owner' || r === 'admin'),
  );

  return (
    <div className="max-w-xl space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}/classes`}>{c.back}</BackLink>
      <h1 className="text-2xl font-semibold">{c.add}</h1>
      <form onSubmit={onSubmit} className={`${card} space-y-4 p-5`}>
        <Field
          label={c.name}
          value={form.name}
          onChange={set('name')}
          required
          maxLength={200}
          placeholder="2027 A/L Theory"
        />
        <Field
          label={c.subject}
          hint={c.subjectHint}
          value={form.subject}
          onChange={set('subject')}
          required
          maxLength={100}
          list="subjects"
        />
        <datalist id="subjects">
          {subjects.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-muted">{c.teacher}</span>
          <select
            value={form.teacherMembershipId}
            onChange={set('teacherMembershipId')}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5"
          >
            <option value="">{c.noTeacher}</option>
            {teachers.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink-muted">{c.mode}</span>
          <select
            value={form.mode}
            onChange={set('mode')}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5"
          >
            <option value="physical">{c.physical}</option>
            <option value="online">{c.online}</option>
            <option value="hybrid">{c.hybrid}</option>
          </select>
        </label>
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          {c.create}
        </Button>
      </form>
    </div>
  );
}
