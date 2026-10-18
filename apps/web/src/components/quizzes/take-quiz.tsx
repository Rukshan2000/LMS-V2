'use client';

import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  CloudOff,
  LoaderCircle,
  Send,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { ApiError, api, errorMessage, fmt } from '@/lib/api';
import { BackLink, Badge, btn, card, FormError, Skeleton } from '../ui';
import { isAuto, LETTERS, type AttemptView } from './types';

/** One attempt: the quiz while it runs, the result once it is submitted. */
export function TakeQuiz() {
  const { lang, t } = useI18n();
  const { tenantId, attemptId } = useParams<{ tenantId: string; attemptId: string }>();
  const url = `/tenants/${tenantId}/portal/attempts/${attemptId}`;
  const [view, setView] = useState<AttemptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AttemptView>(url)
      .then(setView)
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, t]);
  useEffect(load, [load]);

  if (!view) return error ? <FormError message={error} /> : <Skeleton />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href={`/${lang}/t/${tenantId}`}>{t.nav.overview}</BackLink>
      {view.attempt.status === 'in_progress' ? (
        <Sitting view={view} url={url} onDone={load} />
      ) : (
        <Result view={view} />
      )}
    </div>
  );
}

type Save = 'saved' | 'saving' | 'offline';
/** What PUT …/answers/:questionId takes: options for MCQ, text for typed questions. */
type AnswerBody = { optionIds: string[] } | { text: string };
const answered = (a?: AnswerBody) =>
  !!a && ('text' in a ? a.text.trim() !== '' : a.optionIds.length > 0);
const chosen = (a?: AnswerBody) => (a && 'optionIds' in a ? a.optionIds : []);
const typed = (a?: AnswerBody) => (a && 'text' in a ? a.text : '');
/** Typing is saved after a short pause instead of on every key. */
const TYPING_DELAY = 1500;
const backupKey = (attemptId: string) => `quiz-answers:${attemptId}`;

function Sitting({ view, url, onDone }: { view: AttemptView; url: string; onDone: () => void }) {
  const { t } = useI18n();
  const q = t.quizzes;
  const { questions, attempt } = view;
  // Answers the server has not confirmed yet, kept in localStorage so a reload or a lost
  // connection keeps them. This screen only renders in the browser, after the attempt loads.
  const [restored] = useState<Record<string, AnswerBody>>(() => {
    try {
      return JSON.parse(localStorage.getItem(backupKey(attempt.id)) ?? '{}');
    } catch {
      return {};
    }
  });
  const [answers, setAnswers] = useState<Record<string, AnswerBody>>(() => ({
    ...Object.fromEntries(
      questions.map((x) => [
        x.id,
        isAuto(x.type) ? { optionIds: x.chosen } : { text: x.text ?? '' },
      ]),
    ),
    ...restored,
  }));
  const pending = useRef(restored);
  const [save, setSave] = useState<Save>('saved');
  const [index, setIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server time minus device time: the countdown follows the server's clock, not the phone's.
  const [skew] = useState(() => new Date(attempt.now).getTime() - Date.now());
  const deadline = new Date(attempt.deadline).getTime();
  const [left, setLeft] = useState(() => deadline - (Date.now() + skew));
  const submitting = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    const entries = Object.entries(pending.current);
    if (!entries.length) return setSave('saved');
    setSave('saving');
    for (const [questionId, body] of entries) {
      try {
        await api(`${url}/answers/${questionId}`, { method: 'PUT', body });
        if (pending.current[questionId] === body) delete pending.current[questionId];
      } catch (err) {
        if (err instanceof ApiError && err.code === 'time_up') return onDone();
        if (err instanceof ApiError && err.status === 0) return setSave('offline');
        delete pending.current[questionId];
        setError(errorMessage(t, err));
      }
    }
    try {
      localStorage.setItem(backupKey(attempt.id), JSON.stringify(pending.current));
    } catch {}
    setSave(Object.keys(pending.current).length ? 'offline' : 'saved');
  }, [url, attempt.id, onDone, t]);

  // Send answers restored from before a reload.
  useEffect(() => {
    if (Object.keys(pending.current).length) void flush();
  }, [flush]);

  // Retry while offline; also when the browser says the connection is back.
  useEffect(() => {
    if (save !== 'offline') return;
    const timer = setInterval(flush, 5000);
    addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      removeEventListener('online', flush);
    };
  }, [save, flush]);

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    clearTimeout(typingTimer.current);
    await flush();
    try {
      await api(`${url}/submit`, { method: 'POST' });
      try {
        localStorage.removeItem(backupKey(attempt.id));
      } catch {}
      onDone();
    } catch (err) {
      submitting.current = false;
      setError(errorMessage(t, err));
    }
  }, [flush, url, attempt.id, onDone, t]);

  useEffect(() => {
    const timer = setInterval(() => {
      const ms = deadline - (Date.now() + skew);
      setLeft(ms);
      // Time is up: send what we have. The server keeps answers saved before the deadline.
      if (ms <= 0) {
        clearInterval(timer);
        void submit();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, skew, submit]);

  function remember(questionId: string, body: AnswerBody) {
    setAnswers((a) => ({ ...a, [questionId]: body }));
    pending.current[questionId] = body;
    try {
      localStorage.setItem(backupKey(attempt.id), JSON.stringify(pending.current));
    } catch {}
    clearTimeout(typingTimer.current);
    if ('text' in body) typingTimer.current = setTimeout(flush, TYPING_DELAY);
    else void flush();
  }
  function choose(questionId: string, optionId: string, multi: boolean) {
    const current = chosen(answers[questionId]);
    remember(questionId, {
      optionIds: multi
        ? current.includes(optionId)
          ? current.filter((x) => x !== optionId)
          : [...current, optionId]
        : [optionId],
    });
  }

  const question = questions[index]!;
  const multi = question.type === 'multi';
  const unanswered = questions.filter((x) => !answered(answers[x.id])).length;
  const secs = Math.max(0, Math.floor(left / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const urgency =
    secs <= 60
      ? 'bg-danger-soft text-danger'
      : secs <= 300
        ? 'bg-warning-soft text-warning'
        : 'bg-surface-soft text-ink';

  return (
    <div className="space-y-4">
      <div className={`${card} sticky top-2 z-10 flex flex-wrap items-center gap-3 px-4 py-3`}>
        <div className="mr-auto min-w-0">
          <h1 className="truncate font-semibold">{view.quiz.title}</h1>
          <p className="text-xs text-ink-subtle">{view.quiz.batchName}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-ink-subtle" role="status">
          {save === 'saving' && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          {save === 'saved' && <CircleCheck aria-hidden className="size-3.5 text-success" />}
          {save === 'offline' && <CloudOff aria-hidden className="size-3.5 text-danger" />}
          {save === 'saving' ? q.saving : save === 'saved' ? q.savedShort : q.offline}
        </span>
        <span
          aria-label={q.timeLeft}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums transition-colors ${urgency}`}
        >
          <Clock aria-hidden className="size-4" />
          {clock}
        </span>
      </div>

      {index === 0 && view.quiz.instructions && (
        <p className="whitespace-pre-line rounded-lg bg-primary-soft/60 px-4 py-3 text-sm">
          {view.quiz.instructions}
        </p>
      )}

      <section key={question.id} className={`${card} animate-fade-in space-y-4 p-4 sm:p-6`}>
        <p className="flex items-center justify-between gap-2 text-sm text-ink-subtle">
          <span>
            {fmt(q.question, { n: index + 1 })} / {questions.length}
          </span>
          <span>{fmt(q.marks, { n: question.points })}</span>
        </p>
        <p className="whitespace-pre-line text-lg">{question.body}</p>
        {isAuto(question.type) && (
          <p className="text-sm text-ink-muted">{multi ? q.chooseMany : q.chooseOne}</p>
        )}
        {question.type === 'short' && (
          <input
            aria-label={q.typePlaceholder}
            placeholder={q.typePlaceholder}
            maxLength={500}
            value={typed(answers[question.id])}
            onChange={(e) => remember(question.id, { text: e.target.value })}
            className="w-full rounded-xl border border-line-strong px-4 py-3 text-base"
          />
        )}
        {question.type === 'essay' && (
          <textarea
            aria-label={q.typePlaceholder}
            placeholder={q.typePlaceholder}
            rows={10}
            maxLength={20000}
            value={typed(answers[question.id])}
            onChange={(e) => remember(question.id, { text: e.target.value })}
            className="w-full rounded-xl border border-line-strong px-4 py-3 text-base leading-relaxed"
          />
        )}
        <ul className="space-y-2">
          {question.options.map((o, i) => {
            const on = chosen(answers[question.id]).includes(o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => choose(question.id, o.id, multi)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition duration-150 active:scale-[0.99] ${
                    on
                      ? 'border-primary bg-primary-soft text-primary-hover'
                      : 'border-line-strong bg-surface hover:border-primary-ring hover:bg-surface-soft'
                  }`}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center font-mono text-sm font-semibold ${multi ? 'rounded-md' : 'rounded-full'} ${on ? 'bg-primary text-white' : 'bg-surface-soft text-ink-muted'}`}
                  >
                    {LETTERS[i]}
                  </span>
                  <span className="whitespace-pre-line">{o.body}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          className={btn('secondary', 'md')}
        >
          <ChevronLeft aria-hidden className="size-4" />
          {q.prev}
        </button>
        <span className="flex-1" />
        {index < questions.length - 1 ? (
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            className={btn('primary', 'md')}
          >
            {q.next}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={btn('success', 'md')}
          >
            <Send aria-hidden className="size-4" />
            {q.submit}
          </button>
        )}
      </div>

      {/* Question map: jump anywhere; answered ones are filled. */}
      <nav aria-label={q.questions} className="flex flex-wrap gap-1.5">
        {questions.map((x, i) => {
          const done = answered(answers[x.id]);
          return (
            <button
              key={x.id}
              type="button"
              aria-current={i === index ? 'step' : undefined}
              onClick={() => setIndex(i)}
              className={`size-9 rounded-lg font-mono text-sm transition-colors ${
                i === index ? 'ring-2 ring-primary ring-offset-1' : ''
              } ${done ? 'bg-primary text-white' : 'bg-surface text-ink-muted border border-line-strong hover:bg-surface-soft'}`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>

      {confirming && (
        <div
          role="alertdialog"
          className={`${card} animate-pop-in space-y-3 border-primary-ring p-4`}
        >
          <p>{unanswered ? fmt(q.confirmSubmit, { n: unanswered }) : q.confirmSubmitAll}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={submit} className={btn('success', 'md')}>
              <Send aria-hidden className="size-4" />
              {q.submitNow}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={btn('secondary', 'md')}
            >
              {q.keepAnswering}
            </button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

function Result({ view }: { view: AttemptView }) {
  const { t } = useI18n();
  const q = t.quizzes;
  const { attempt, quiz, questions } = view;

  return (
    <div className="space-y-4">
      <div className={`${card} animate-pop-in space-y-2 p-6 text-center`}>
        <h1 className="text-xl font-semibold">{quiz.title}</h1>
        <p className="text-sm text-ink-subtle">{quiz.batchName}</p>
        {attempt.status === 'timed_out' && <p className="text-sm text-late">{q.timeUp}</p>}
        {attempt.resultsOut ? (
          <>
            <p className="text-sm text-ink-muted">{q.yourScore}</p>
            <p className="font-mono text-4xl font-semibold text-primary">
              {attempt.score} <span className="text-xl text-ink-subtle">/ {quiz.totalPoints}</span>
            </p>
            {quiz.totalPoints > 0 && (
              <p className="text-ink-muted">
                {Math.round(((attempt.score ?? 0) * 100) / quiz.totalPoints)}%
              </p>
            )}
            {attempt.rank && (
              <p className="text-sm font-medium text-primary-hover">
                {fmt(q.classRank, { rank: attempt.rank, of: attempt.of ?? '' })}
              </p>
            )}
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-success">
            <CircleCheck aria-hidden className="size-5" />
            {q.waiting}
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {questions.map((x, i) => {
          const showKey = x.options.some((o) => o.correct !== undefined);
          return (
            <li key={x.id} className={`${card} space-y-3 p-4`}>
              <p className="flex items-start justify-between gap-2 text-sm text-ink-subtle">
                {fmt(q.question, { n: i + 1 })}
                {x.score !== undefined && (
                  <Badge tone={x.score === x.points ? 'success' : x.score ? 'warning' : 'danger'}>
                    {x.score ?? '–'} / {x.points}
                  </Badge>
                )}
              </p>
              <p className="whitespace-pre-line">{x.body}</p>
              <ul className="space-y-1.5 text-sm">
                {x.options.map((o, j) => {
                  const chosen = x.chosen.includes(o.id);
                  const tone = showKey
                    ? o.correct
                      ? 'border-success/40 bg-success-soft'
                      : chosen
                        ? 'border-danger/30 bg-danger-soft'
                        : 'border-line'
                    : chosen
                      ? 'border-primary bg-primary-soft'
                      : 'border-line';
                  return (
                    <li
                      key={o.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${tone}`}
                    >
                      <span className="font-mono font-semibold text-ink-muted">{LETTERS[j]}</span>
                      <span className="flex-1">{o.body}</span>
                      {showKey && o.correct && (
                        <CircleCheck aria-label={q.correct} className="size-4 text-success" />
                      )}
                      {showKey && chosen && !o.correct && (
                        <CircleX aria-hidden className="size-4 text-danger" />
                      )}
                    </li>
                  );
                })}
              </ul>
              {x.text?.trim() && (
                <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-soft px-3 py-2 text-sm">
                  {x.text}
                </p>
              )}
              {!x.chosen.length && !x.text?.trim() && (
                <p className="text-sm text-ink-subtle">{q.unanswered}</p>
              )}
              {x.comment && (
                <p className="rounded-lg bg-surface-soft px-3 py-2 text-sm">
                  <span className="font-medium">{q.comment}:</span> {x.comment}
                </p>
              )}
              {x.explanation && (
                <p className="rounded-lg bg-primary-soft/60 px-3 py-2 text-sm">
                  <span className="font-medium">{q.explanationLabel}:</span> {x.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
