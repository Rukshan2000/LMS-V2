'use client';

import { ChevronRight, ListChecks, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { colomboDate, fmtDay, fmtTime, fromLocalInput, toLocalInput } from '@/lib/datetime';
import type { BatchSummary } from '../classes/types';
import { Badge, btn, Button, card, EmptyState, Field, FormError, Skeleton, type Tone } from '../ui';
import type { QuizStatus, QuizSummary } from './types';

export const STATUS_TONE: Record<QuizStatus, Tone> = {
  draft: 'neutral',
  published: 'primary',
  released: 'success',
};

/** "Sat 17 Oct · 14:00" in Sri Lanka time. */
export const when = (iso: string, cal: { weekdays: string[]; months: string[] }) =>
  `${fmtDay(iso, cal)} · ${fmtTime(iso)}`;

export function QuizList() {
  const { lang, t } = useI18n();
  const q = t.quizzes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchId, setBatchId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ batches: BatchSummary[] }>(`/tenants/${tenantId}/batches`)
      .then((r) => setBatches(r.batches))
      .catch(() => {});
  }, [tenantId]);
  useEffect(() => {
    api<{ quizzes: QuizSummary[] }>(
      `/tenants/${tenantId}/quizzes${batchId ? `?batchId=${batchId}` : ''}`,
    )
      .then((r) => setQuizzes(r.quizzes))
      .catch((err) => setError(errorMessage(t, err)));
  }, [tenantId, batchId, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{q.title}</h1>
        <select
          aria-label={q.class}
          value={batchId}
          onChange={(e) => setBatchId(e.target.value)}
          className="rounded-lg border border-line-strong px-3 py-2 text-sm"
        >
          <option value="">{q.allClasses}</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={btn()}>
            <Plus aria-hidden className="size-4" />
            {q.add}
          </button>
        )}
      </div>
      {creating && (
        <NewQuiz
          batches={batches}
          batchId={batchId}
          onCancel={() => setCreating(false)}
          onCreated={(id) => router.push(`/${lang}/t/${tenantId}/quizzes/${id}#questions`)}
        />
      )}
      <FormError message={error} />
      {quizzes === null ? (
        <Skeleton />
      ) : quizzes.length === 0 ? (
        <EmptyState icon={ListChecks}>{q.none}</EmptyState>
      ) : (
        <ul className={`${card} divide-y divide-line`}>
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Link
                href={`/${lang}/t/${tenantId}/quizzes/${quiz.id}`}
                className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-surface-soft/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {quiz.title}
                    <Badge tone={STATUS_TONE[quiz.status]}>{q.status[quiz.status]}</Badge>
                    {quiz.status !== 'draft' && !quiz.closed && !quiz.upcoming && (
                      <Badge tone="success">{q.open}</Badge>
                    )}
                  </span>
                  <span className="block text-ink-subtle">
                    {quiz.batchName} · {when(quiz.opensAt, t.calendar)} →{' '}
                    {colomboDate(quiz.closesAt) === colomboDate(quiz.opensAt)
                      ? fmtTime(quiz.closesAt)
                      : when(quiz.closesAt, t.calendar)}
                  </span>
                </span>
                <span className="text-ink-muted">
                  {fmt(q.count, { n: quiz.questions })} · {fmt(q.marks, { n: quiz.totalPoints })}
                </span>
                {quiz.status !== 'draft' && (
                  <span className="text-ink-muted">
                    {q.submitted}: <span className="font-mono">{quiz.submitted}</span>
                  </span>
                )}
                <ChevronRight
                  aria-hidden
                  className="size-4 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewQuiz({
  batches,
  batchId,
  onCancel,
  onCreated,
}: {
  batches: BatchSummary[];
  batchId: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const { tenantId } = useParams<{ tenantId: string }>();
  // Default: opens in an hour (on the hour), open for two hours.
  const [form, setForm] = useState(() => {
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
    return {
      batchId: batchId || batches[0]?.id || '',
      title: '',
      opensAt: toLocalInput(start.toISOString()),
      closesAt: toLocalInput(new Date(start.getTime() + 2 * 3_600_000).toISOString()),
      timeLimitMinutes: '',
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { quiz } = await api<{ quiz: { id: string } }>(`/tenants/${tenantId}/quizzes`, {
        method: 'POST',
        body: {
          batchId: form.batchId || batches[0]?.id,
          title: form.title,
          opensAt: fromLocalInput(form.opensAt),
          closesAt: fromLocalInput(form.closesAt),
          timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
        },
      });
      onCreated(quiz.id);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={`${card} animate-fade-in grid gap-4 p-4 sm:grid-cols-2`}>
      <Field
        label={q.name}
        value={form.title}
        onChange={set('title')}
        required
        maxLength={200}
        placeholder="Term test 1"
      />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink-muted">{q.class}</span>
        <select
          required
          value={form.batchId || batches[0]?.id || ''}
          onChange={set('batchId')}
          className="w-full rounded-lg border border-line-strong px-3 py-2.5"
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.subjectName}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={q.opensAt}
        type="datetime-local"
        value={form.opensAt}
        onChange={set('opensAt')}
        required
      />
      <Field
        label={q.closesAt}
        type="datetime-local"
        value={form.closesAt}
        min={form.opensAt}
        onChange={set('closesAt')}
        required
      />
      <Field
        label={q.timeLimit}
        hint={q.timeLimitHint}
        type="number"
        min={1}
        max={1440}
        value={form.timeLimitMinutes}
        onChange={set('timeLimitMinutes')}
      />
      <div className="space-y-3 sm:col-span-2">
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={busy} full={false} icon={Plus}>
            {q.create}
          </Button>
          <button type="button" onClick={onCancel} className={btn('secondary', 'md')}>
            <X aria-hidden className="size-4" />
            {q.cancel}
          </button>
        </div>
      </div>
    </form>
  );
}
