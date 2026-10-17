'use client';

import {
  ArrowDown,
  ArrowUp,
  ChartColumn,
  Copy,
  EyeOff,
  Plus,
  Save,
  Send,
  Settings2,
  ListChecks,
  Trash2,
  Undo2,
  Megaphone,
  PenLine,
  X,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { ApiError, api, errorMessage, fmt } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import {
  BackLink,
  Badge,
  btn,
  Button,
  card,
  ConfirmButton,
  Field,
  FormError,
  Skeleton,
  Tabs,
  useToast,
} from '../ui';
import type { BatchSummary } from '../classes/types';
import { Marking } from './marking';
import { Results } from './results';
import { STATUS_TONE } from './quiz-list';
import { isAuto, LETTERS, type Question, type Quiz } from './types';

const textarea = 'w-full rounded-lg border border-line-strong px-3 py-2 text-sm';

export function QuizEditor() {
  const { lang, t } = useI18n();
  const q = t.quizzes;
  const { tenantId, quizId } = useParams<{ tenantId: string; quizId: string }>();
  const router = useRouter();
  const toast = useToast();
  const url = `/tenants/${tenantId}/quizzes/${quizId}`;
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [unmarked, setUnmarked] = useState(0);
  const [toMark, setToMark] = useState(0);
  // Bumped after a mark or a release, so Results reloads.
  const [version, setVersion] = useState(0);
  const onMarked = useCallback((n: number) => {
    setToMark(n);
    setVersion((v) => v + 1);
  }, []);

  const load = useCallback(() => {
    api<{ quiz: Quiz; questions: Question[] }>(url)
      .then((r) => {
        setQuiz(r.quiz);
        setQuestions(r.questions);
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, t]);
  useEffect(load, [load]);

  async function action(name: 'publish' | 'unpublish' | 'release' | 'unrelease', force = false) {
    setError(null);
    setProblems([]);
    setUnmarked(0);
    try {
      const r = await api<{ quiz: Quiz }>(`${url}/${name}`, {
        method: 'POST',
        body: force ? { force } : undefined,
      });
      setQuiz((old) => old && { ...old, ...r.quiz });
      setVersion((v) => v + 1);
    } catch (err) {
      // Answers still to mark: ask before releasing only the marked results.
      if (err instanceof ApiError && err.code === 'unmarked') {
        return setUnmarked((err.details as { count: number }).count);
      }
      const list =
        err instanceof ApiError && err.code === 'quiz_incomplete'
          ? (err.details as { problems: { code: keyof typeof q.problems; question?: number }[] })
              .problems
          : null;
      if (list) setProblems(list.map((p) => fmt(q.problems[p.code], { n: p.question ?? '' })));
      else setError(errorMessage(t, err));
    }
  }

  if (!quiz) return error ? <FormError message={error} /> : <Skeleton />;
  const live = quiz.status !== 'draft';

  return (
    <div className="space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}/quizzes`}>{q.back}</BackLink>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {quiz.title}
            <Badge tone={STATUS_TONE[quiz.status]}>{q.status[quiz.status]}</Badge>
          </h1>
          <p className="text-ink-muted">
            {quiz.batchName} · {fmt(q.count, { n: questions.length })} ·{' '}
            {fmt(q.marks, { n: quiz.totalPoints })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Duplicate url={url} batchId={quiz.batchId} />
          {quiz.status === 'draft' && (
            <>
              <ConfirmButton
                icon={Trash2}
                onConfirm={async () => {
                  try {
                    await api(url, { method: 'DELETE' });
                    router.replace(`/${lang}/t/${tenantId}/quizzes`);
                  } catch (err) {
                    setError(errorMessage(t, err));
                  }
                }}
              >
                {q.delete}
              </ConfirmButton>
              <button type="button" onClick={() => action('publish')} className={btn()}>
                <Send aria-hidden className="size-4" />
                {q.publish}
              </button>
            </>
          )}
          {quiz.status === 'published' && !quiz.started && (
            <button type="button" onClick={() => action('unpublish')} className={btn('secondary')}>
              <Undo2 aria-hidden className="size-4" />
              {q.unpublish}
            </button>
          )}
          {quiz.status === 'published' &&
            (quiz.closed ? (
              <button type="button" onClick={() => action('release')} className={btn('success')}>
                <Megaphone aria-hidden className="size-4" />
                {q.release}
              </button>
            ) : (
              // Still open: releasing now can show answers to students who are still sitting it.
              <span title={q.releaseEarly}>
                <ConfirmButton
                  icon={Megaphone}
                  confirmLabel={q.release}
                  onConfirm={() => action('release')}
                >
                  {q.release}
                </ConfirmButton>
              </span>
            ))}
          {quiz.status === 'released' && (
            <button type="button" onClick={() => action('unrelease')} className={btn('secondary')}>
              <EyeOff aria-hidden className="size-4" />
              {q.unrelease}
            </button>
          )}
        </div>
      </div>
      <FormError message={error} />
      {unmarked > 0 && (
        <div
          role="alert"
          className={`${card} animate-pop-in space-y-3 border-warning/40 p-4 text-sm`}
        >
          <p>{fmt(q.unmarkedConfirm, { n: unmarked })}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => action('release', true)}
              className={btn('success')}
            >
              <Megaphone aria-hidden className="size-4" />
              {q.releaseMarked}
            </button>
            <button type="button" onClick={() => setUnmarked(0)} className={btn('secondary')}>
              {q.cancel}
            </button>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <ul
          role="alert"
          className="animate-fade-in space-y-1 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <Tabs
        items={[
          {
            id: 'settings',
            icon: Settings2,
            label: q.settings,
            content: (
              <SettingsForm
                quiz={quiz}
                url={url}
                onSaved={(next) => {
                  setQuiz((old) => old && { ...old, ...next });
                  toast(q.saved);
                }}
              />
            ),
          },
          {
            id: 'questions',
            icon: ListChecks,
            label: (
              <>
                {q.questions}
                <span className="rounded-full bg-surface-soft px-2 text-xs text-ink-muted">
                  {questions.length}
                </span>
              </>
            ),
            content: (
              <QuestionsBuilder
                key={questions.map((x) => x.id).join()}
                initial={questions}
                started={!!quiz.started}
                url={url}
                onSaved={(next) => {
                  setQuestions(next);
                  setQuiz(
                    (old) =>
                      old && {
                        ...old,
                        totalPoints: next.reduce((sum, x) => sum + x.points, 0),
                      },
                  );
                  toast(q.saved);
                }}
              />
            ),
          },
          live && {
            id: 'results',
            icon: ChartColumn,
            label: q.results,
            content: <Results url={url} version={version} />,
          },
          live && {
            id: 'marking',
            icon: PenLine,
            label: (
              <>
                {q.marking}
                {toMark > 0 && (
                  <span className="rounded-full bg-warning-soft px-2 text-xs text-warning">
                    {toMark}
                  </span>
                )}
              </>
            ),
            content: <Marking url={url} onChange={onMarked} />,
          },
        ]}
      />
    </div>
  );
}

function SettingsForm({
  quiz,
  url,
  onSaved,
}: {
  quiz: Quiz;
  url: string;
  onSaved: (quiz: Quiz) => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const [form, setForm] = useState(() => ({
    ...quiz,
    instructions: quiz.instructions ?? '',
    opensAt: toLocalInput(quiz.opensAt),
    closesAt: toLocalInput(quiz.closesAt),
    timeLimitMinutes: quiz.timeLimitMinutes ? String(quiz.timeLimitMinutes) : '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set =
    (key: 'title' | 'instructions' | 'opensAt' | 'closesAt' | 'timeLimitMinutes' | 'autoRelease') =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (
    key: 'shuffleQuestions' | 'shuffleOptions' | 'showCorrect' | 'showExplanations' | 'requirePaid',
  ) => (
    <label key={key} className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
        className="mt-0.5 size-4"
      />
      {q[key]}
    </label>
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ quiz: Quiz }>(url, {
        method: 'PATCH',
        body: {
          title: form.title,
          instructions: form.instructions || null,
          opensAt: fromLocalInput(form.opensAt),
          closesAt: fromLocalInput(form.closesAt),
          timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
          shuffleQuestions: form.shuffleQuestions,
          shuffleOptions: form.shuffleOptions,
          showCorrect: form.showCorrect,
          showExplanations: form.showExplanations,
          requirePaid: form.requirePaid,
          autoRelease: form.autoRelease,
        },
      });
      onSaved(r.quiz);
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className={`${card} grid gap-4 p-4 sm:grid-cols-2`}>
      <div className="sm:col-span-2">
        <Field label={q.name} value={form.title} onChange={set('title')} required maxLength={200} />
      </div>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink-muted">{q.instructions}</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={form.instructions}
          onChange={set('instructions')}
          className={textarea}
        />
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
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink-muted">{q.autoRelease}</span>
        <select
          value={form.autoRelease}
          onChange={set('autoRelease')}
          className="w-full rounded-lg border border-line-strong px-3 py-2.5"
        >
          <option value="on_close">{q.releaseOnClose}</option>
          <option value="on_submit">{q.releaseOnSubmit}</option>
          <option value="off">{q.releaseOff}</option>
        </select>
      </label>
      <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
        {toggle('shuffleQuestions')}
        {toggle('shuffleOptions')}
        {toggle('showCorrect')}
        {toggle('showExplanations')}
        {toggle('requirePaid')}
      </fieldset>
      <div className="space-y-3 sm:col-span-2">
        <FormError message={error} />
        <Button type="submit" busy={busy} full={false} icon={Save}>
          {q.save}
        </Button>
      </div>
    </form>
  );
}

const blank = (): Question => ({
  type: 'mcq',
  body: '',
  explanation: null,
  points: 1,
  multiScoring: 'all_or_nothing',
  options: [0, 1, 2, 3].map(() => ({ body: '', isCorrect: false })),
});

function QuestionsBuilder({
  initial,
  started,
  url,
  onSaved,
}: {
  initial: Question[];
  started: boolean;
  url: string;
  onSaved: (questions: Question[]) => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const toast = useToast();
  const [list, setList] = useState<Question[]>(() => (initial.length ? initial : [blank()]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Question>) =>
    setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setList((l) => {
      const next = [...l];
      [next[i], next[i + by]] = [next[i + by]!, next[i]!];
      return next;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ questions: Question[] }>(`${url}/questions`, {
        method: 'PUT',
        // The API ignores ids: the list is replaced as a whole.
        body: { questions: list },
      });
      onSaved(r.questions);
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }

  async function saveKey(question: Question) {
    setError(null);
    try {
      const r = await api<{ remarked: number }>(`${url}/questions/${question.id}/key`, {
        method: 'PUT',
        body: { correct: question.options.filter((o) => o.isCorrect).map((o) => o.id) },
      });
      toast(fmt(q.remarked, { n: r.remarked }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <div className="space-y-4">
      {started && (
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">{q.locked}</p>
      )}
      <ol className="space-y-4">
        {list.map((question, i) => (
          <QuestionCard
            key={question.id ?? `new-${i}`}
            n={i + 1}
            question={question}
            locked={started}
            onChange={(patch) => update(i, patch)}
            onMove={(by) => move(i, by)}
            onRemove={() => setList((l) => l.filter((_, j) => j !== i))}
            onSaveKey={() => saveKey(question)}
            first={i === 0}
            last={i === list.length - 1}
          />
        ))}
      </ol>
      <FormError message={error} />
      {!started && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setList((l) => [...l, blank()])}
            className={btn('secondary', 'md')}
          >
            <Plus aria-hidden className="size-4" />
            {q.addQuestion}
          </button>
          <Button type="button" onClick={save} busy={busy} full={false} icon={Save}>
            {q.saveQuestions}
          </Button>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  n,
  question,
  locked,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onSaveKey,
}: {
  n: number;
  question: Question;
  locked: boolean;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<Question>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
  onSaveKey: () => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const name = useId();
  const setOption = (i: number, patch: Partial<Question['options'][number]>) =>
    onChange({
      options: question.options.map((o, j) =>
        j === i
          ? { ...o, ...patch }
          : // One correct answer: ticking another clears the rest.
            patch.isCorrect && question.type === 'mcq'
            ? { ...o, isCorrect: false }
            : o,
      ),
    });
  const iconBtn =
    'rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-30';

  return (
    <li className={`${card} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-medium">{fmt(q.question, { n })}</h3>
        <select
          aria-label={q.question}
          disabled={locked}
          value={question.type}
          onChange={(e) => {
            const type = e.target.value as Question['type'];
            // mcq allows one correct answer: keep only the first ticked one.
            const firstRight = question.options.findIndex((o) => o.isCorrect);
            onChange({
              type,
              options: !isAuto(type)
                ? []
                : !question.options.length
                  ? blank().options
                  : type === 'mcq'
                    ? question.options.map((o, i) => ({ ...o, isCorrect: i === firstRight }))
                    : question.options,
            });
          }}
          className="rounded-lg border border-line-strong px-2 py-1.5 text-sm"
        >
          <option value="mcq">{q.typeMcq}</option>
          <option value="multi">{q.typeMulti}</option>
          <option value="short">{q.typeShort}</option>
          <option value="essay">{q.typeEssay}</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          {q.points}
          <input
            type="number"
            min={0.5}
            max={999}
            step={0.5}
            disabled={locked}
            value={question.points}
            onChange={(e) => onChange({ points: Number(e.target.value) })}
            className="w-20 rounded-lg border border-line-strong px-2 py-1.5"
          />
        </label>
        {!locked && (
          <span className="flex">
            <button
              type="button"
              aria-label={q.moveUp}
              disabled={first}
              onClick={() => onMove(-1)}
              className={iconBtn}
            >
              <ArrowUp aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={q.moveDown}
              disabled={last}
              onClick={() => onMove(1)}
              className={iconBtn}
            >
              <ArrowDown aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              aria-label={q.remove}
              onClick={onRemove}
              className={`${iconBtn} hover:text-danger`}
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </span>
        )}
      </div>
      <textarea
        aria-label={fmt(q.question, { n })}
        rows={2}
        maxLength={5000}
        readOnly={locked}
        value={question.body}
        onChange={(e) => onChange({ body: e.target.value })}
        className={textarea}
      />
      {!isAuto(question.type) && <p className="text-sm text-ink-subtle">{q.typedHint}</p>}
      <ul className="space-y-2">
        {question.options.map((o, i) => (
          <li key={o.id ?? i} className="flex items-center gap-2">
            <label
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${o.isCorrect ? 'bg-success-soft text-success' : 'text-ink-subtle hover:bg-surface-soft'}`}
            >
              <input
                type={question.type === 'mcq' ? 'radio' : 'checkbox'}
                name={name}
                checked={o.isCorrect}
                onChange={(e) => setOption(i, { isCorrect: e.target.checked })}
                className="size-4"
              />
              <span className="font-mono">{LETTERS[i]}</span>
              <span className="sr-only">{q.correct}</span>
            </label>
            <input
              aria-label={fmt(q.option, { letter: LETTERS[i]! })}
              maxLength={1000}
              readOnly={locked}
              value={o.body}
              onChange={(e) => setOption(i, { body: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm"
            />
            {!locked && question.options.length > 2 && (
              <button
                type="button"
                aria-label={q.remove}
                onClick={() => onChange({ options: question.options.filter((_, j) => j !== i) })}
                className={iconBtn}
              >
                <X aria-hidden className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!locked && isAuto(question.type) && question.options.length < 6 && (
          <button
            type="button"
            onClick={() =>
              onChange({ options: [...question.options, { body: '', isCorrect: false }] })
            }
            className={btn('link', 'none')}
          >
            <Plus aria-hidden className="size-4" />
            {q.addOption}
          </button>
        )}
        {question.type === 'multi' && (
          <label className="flex items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              disabled={locked}
              checked={question.multiScoring === 'partial'}
              onChange={(e) =>
                onChange({ multiScoring: e.target.checked ? 'partial' : 'all_or_nothing' })
              }
              className="size-4"
            />
            {q.partial}
          </label>
        )}
        {locked && isAuto(question.type) && (
          <button type="button" onClick={onSaveKey} className={btn('secondary')}>
            <Save aria-hidden className="size-4" />
            {q.fixKey}
          </button>
        )}
      </div>
      <details className="text-sm" open={!!question.explanation}>
        <summary className="w-fit cursor-pointer text-ink-muted hover:text-ink">
          {q.explanation}
        </summary>
        <textarea
          rows={2}
          maxLength={5000}
          readOnly={locked}
          value={question.explanation ?? ''}
          onChange={(e) => onChange({ explanation: e.target.value || null })}
          className={`${textarea} mt-2`}
        />
      </details>
    </li>
  );
}

/** Copy the quiz as a new draft, for this or another class. */
function Duplicate({ url, batchId }: { url: string; batchId: string }) {
  const { lang, t } = useI18n();
  const q = t.quizzes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [target, setTarget] = useState(batchId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api<{ batches: BatchSummary[] }>(`/tenants/${tenantId}/batches`)
      .then((r) => setBatches(r.batches))
      .catch(() => {});
  }, [open, tenantId]);

  async function copy() {
    setError(null);
    try {
      const r = await api<{ quiz: Quiz }>(`${url}/duplicate`, {
        method: 'POST',
        body: { batchId: target },
      });
      router.push(`/${lang}/t/${tenantId}/quizzes/${r.quiz.id}#settings`);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn('linkMuted', 'none')}>
        <Copy aria-hidden className="size-4" />
        {q.duplicate}
      </button>
    );
  return (
    <span className="flex animate-fade-in flex-wrap items-center gap-2">
      <select
        aria-label={q.duplicateTo}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded-lg border border-line-strong px-2 py-1.5 text-sm"
      >
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={copy} className={btn('secondary')}>
        <Copy aria-hidden className="size-4" />
        {q.makeCopy}
      </button>
      <button
        type="button"
        aria-label={q.cancel}
        onClick={() => setOpen(false)}
        className={btn('linkMuted', 'none')}
      >
        <X aria-hidden className="size-4" />
      </button>
      <FormError message={error} />
    </span>
  );
}
