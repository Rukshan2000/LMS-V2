'use client';

import { CircleCheck, CircleX, Eye, EyeOff, PartyPopper, Save } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { Badge, btn, card, EmptyState, FormError, Skeleton } from '../ui';
import { isAuto, LETTERS, type MarkingAnswer, type Question } from './types';

interface Summary {
  questions: { id: string; type: Question['type']; body: string; points: number; toMark: number }[];
  attempts: {
    id: string;
    marked: boolean;
    score: number | null;
    fullName: string;
    studentNumber: string;
  }[];
}
type FullQuestion = Question & { id: string };

const short = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** Teacher marking: one question for the whole class, or one student's whole attempt. */
export function Marking({ url, onChange }: { url: string; onChange: (toMark: number) => void }) {
  const { t } = useI18n();
  const q = t.quizzes;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mode, setMode] = useState<'question' | 'student'>('question');
  const [questionId, setQuestionId] = useState('');
  const [attemptId, setAttemptId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api<Summary>(`${url}/marking`)
      .then((s) => {
        setSummary(s);
        onChange(s.questions.reduce((sum, x) => sum + x.toMark, 0));
      })
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, onChange, t]);
  useEffect(refresh, [refresh]);

  if (error) return <FormError message={error} />;
  if (!summary) return <Skeleton />;
  if (!summary.attempts.length) return <p className="text-sm text-ink-subtle">{q.noAnswers}</p>;
  const toMark = summary.questions.reduce((sum, x) => sum + x.toMark, 0);
  // Default: the first question / student with something left to mark.
  const qid =
    questionId ||
    (
      summary.questions.find((x) => x.toMark) ??
      summary.questions.find((x) => !isAuto(x.type)) ??
      summary.questions[0]
    )?.id ||
    '';
  const aid = attemptId || (summary.attempts.find((a) => !a.marked) ?? summary.attempts[0])!.id;
  const tab = (on: boolean) =>
    `px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'bg-primary-soft text-primary-hover' : 'text-ink-muted hover:bg-surface-soft hover:text-ink'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" className={`${card} inline-flex divide-x divide-line overflow-hidden`}>
          <button
            type="button"
            aria-pressed={mode === 'question'}
            onClick={() => setMode('question')}
            className={tab(mode === 'question')}
          >
            {q.byQuestion}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'student'}
            onClick={() => setMode('student')}
            className={tab(mode === 'student')}
          >
            {q.byStudent}
          </button>
        </div>
        {mode === 'question' ? (
          <select
            aria-label={q.questions}
            value={qid}
            onChange={(e) => setQuestionId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-2 text-sm"
          >
            {summary.questions.map((x, i) => (
              <option key={x.id} value={x.id}>
                {fmt(q.question, { n: i + 1 })} · {short(x.body)}
                {x.toMark ? ` · ${q.toMark}: ${x.toMark}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label={q.student}
            value={aid}
            onChange={(e) => setAttemptId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-2 text-sm"
          >
            {summary.attempts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.studentNumber} · {a.fullName} {a.marked ? '✓' : `· ${q.toMark}`}
              </option>
            ))}
          </select>
        )}
      </div>
      {toMark === 0 && <EmptyState icon={PartyPopper}>{q.allMarked}</EmptyState>}
      {mode === 'question' ? (
        <ByQuestion key={qid} url={url} questionId={qid} onSaved={refresh} />
      ) : (
        <ByStudent key={aid} url={url} attemptId={aid} onSaved={refresh} />
      )}
    </div>
  );
}

function ByQuestion({
  url,
  questionId,
  onSaved,
}: {
  url: string;
  questionId: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const [data, setData] = useState<{ question: FullQuestion; answers: MarkingAnswer[] } | null>(
    null,
  );
  // Names hidden by default: marking without knowing who wrote it is fairer.
  const [names, setNames] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<NonNullable<typeof data>>(`${url}/marking/${questionId}`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, questionId, t]);

  if (error) return <FormError message={error} />;
  if (!data) return <Skeleton />;
  return (
    <div className="space-y-3">
      <div className={`${card} space-y-2 p-4`}>
        <p className="flex items-start justify-between gap-3">
          <span className="whitespace-pre-line font-medium">{data.question.body}</span>
          <span className="shrink-0 text-sm text-ink-subtle">
            {fmt(q.marks, { n: data.question.points })}
          </span>
        </p>
        <button type="button" onClick={() => setNames(!names)} className={btn('link', 'none')}>
          {names ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
          {names ? q.hideNames : q.showNames}
        </button>
      </div>
      {data.answers.length === 0 && <p className="text-sm text-ink-subtle">{q.noAnswers}</p>}
      {data.answers.map((a, i) => (
        <AnswerCard
          key={a.id}
          label={names ? `${a.studentNumber} · ${a.fullName}` : fmt(q.answerN, { n: i + 1 })}
          question={data.question}
          answer={a}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function ByStudent({
  url,
  attemptId,
  onSaved,
}: {
  url: string;
  attemptId: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const [data, setData] = useState<{
    attempt: { fullName: string; studentNumber: string; score: number | null; marked: boolean };
    questions: (FullQuestion & { answer: MarkingAnswer | null })[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<NonNullable<typeof data>>(`${url}/attempts/${attemptId}`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, attemptId, t]);

  if (error) return <FormError message={error} />;
  if (!data) return <Skeleton />;
  return (
    <div className="space-y-3">
      {data.questions.map(
        (question, i) =>
          question.answer && (
            <AnswerCard
              key={question.id}
              label={fmt(q.question, { n: i + 1 })}
              body={question.body}
              question={question}
              answer={question.answer}
              onSaved={onSaved}
            />
          ),
      )}
    </div>
  );
}

/** Focus the next answer's marks box (Enter saves and moves on). */
function focusNext(current: HTMLElement) {
  const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-mark-score]')];
  boxes[boxes.indexOf(current as HTMLInputElement) + 1]?.focus();
}

function AnswerCard({
  label,
  body,
  question,
  answer,
  onSaved,
}: {
  label: string;
  /** The question text, when marking a student's whole attempt. */
  body?: string;
  question: FullQuestion;
  answer: MarkingAnswer;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const q = t.quizzes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const [score, setScore] = useState(answer.score === null ? '' : String(answer.score));
  const [comment, setComment] = useState(answer.comment ?? '');
  const [saved, setSaved] = useState(answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value = score, next?: HTMLElement) {
    if (value === '') return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tenants/${tenantId}/quiz-answers/${answer.id}`, {
        method: 'PATCH',
        body: { score: Number(value), comment: comment || null },
      });
      setSaved({ ...saved, score: Number(value), comment, byTeacher: true });
      onSaved();
      if (next) focusNext(next);
    } catch (err) {
      setError(errorMessage(t, err));
    }
    setBusy(false);
  }
  const quick = (value: number) => {
    setScore(String(value));
    void save(String(value));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void save(score, e.currentTarget);
  };
  const dirty =
    score !== (saved.score === null ? '' : String(saved.score)) ||
    comment !== (saved.comment ?? '');

  return (
    <section className={`${card} space-y-3 p-4 ${saved.score === null ? 'border-warning/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="mr-auto font-medium">{label}</span>
        {saved.score === null ? (
          <Badge tone="warning">{q.notMarked}</Badge>
        ) : (
          <Badge tone={saved.byTeacher ? 'primary' : 'neutral'}>
            {saved.byTeacher ? q.byTeacher : q.auto} · {saved.score} / {question.points}
          </Badge>
        )}
      </div>
      {body && <p className="whitespace-pre-line text-sm text-ink-muted">{body}</p>}
      {isAuto(question.type) ? (
        <ul className="space-y-1 text-sm">
          {question.options.map((o, i) => {
            const chosen = answer.chosen.includes(o.id!);
            return (
              <li
                key={o.id}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                  chosen
                    ? o.isCorrect
                      ? 'bg-success-soft'
                      : 'bg-danger-soft'
                    : o.isCorrect
                      ? 'bg-success-soft/50'
                      : ''
                }`}
              >
                <span className="font-mono text-ink-muted">{LETTERS[i]}</span>
                <span className="flex-1">{o.body}</span>
                {o.isCorrect && (
                  <CircleCheck aria-label={q.correct} className="size-4 text-success" />
                )}
                {chosen && !o.isCorrect && <CircleX aria-hidden className="size-4 text-danger" />}
              </li>
            );
          })}
        </ul>
      ) : answer.text?.trim() ? (
        <p className="whitespace-pre-wrap rounded-lg bg-surface-soft px-3 py-2">{answer.text}</p>
      ) : (
        <p className="text-sm text-ink-subtle">{q.unanswered}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {[
          ['0', 0],
          [q.half, question.points / 2],
          [q.full, question.points],
        ].map(([text, value]) => (
          <button
            key={text}
            type="button"
            disabled={busy}
            onClick={() => quick(value as number)}
            className={btn(saved.score === value ? 'primary' : 'secondary', 'xs')}
          >
            {text}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input
            data-mark-score
            type="number"
            min={0}
            max={question.points}
            step={0.5}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            onKeyDown={onKey}
            aria-label={q.score}
            className="w-20 rounded-lg border border-line-strong px-2 py-1 font-mono"
          />
          {fmt(q.outOf, { n: question.points })}
        </label>
      </div>
      <textarea
        rows={1}
        maxLength={2000}
        value={comment}
        placeholder={q.commentPlaceholder}
        onChange={(e) => setComment(e.target.value)}
        className="w-full rounded-lg border border-line-strong px-3 py-1.5 text-sm"
      />
      {dirty && (
        <button
          type="button"
          disabled={busy || score === ''}
          onClick={() => save()}
          className={btn()}
        >
          <Save aria-hidden className="size-4" />
          {q.saveMark}
        </button>
      )}
      <FormError message={error} />
    </section>
  );
}
