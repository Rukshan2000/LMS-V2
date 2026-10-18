'use client';

import { CircleCheck, Download, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { waLink } from '@/lib/whatsapp';
import { useTenantData } from '../dashboard-shell';
import { Badge, btn, card, FormError, Skeleton, type Tone } from '../ui';
import {
  isAuto,
  LETTERS,
  type AttemptStatus,
  type QuestionStat,
  type Quiz,
  type ResultRow,
} from './types';

const ATTEMPT_TONE: Record<AttemptStatus, Tone> = {
  submitted: 'success',
  in_progress: 'warning',
  timed_out: 'late',
};

interface Data {
  quiz: Quiz;
  rows: ResultRow[];
  stats: {
    students: number;
    submitted: number;
    average: number | null;
    highest: number | null;
    lowest: number | null;
    toMark: number;
    ranked: number;
  };
  questions: QuestionStat[];
}

/** Teacher results: class figures, every student with marks and rank, and per-question stats. */
export function Results({ url, version }: { url: string; version: number }) {
  const { t } = useI18n();
  const q = t.quizzes;
  const { tenant } = useTenantData();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Data>(`${url}/results`)
      .then(setData)
      .catch((err) => setError(errorMessage(t, err)));
  }, [url, t, version]);

  if (error) return <FormError message={error} />;
  if (!data) return <Skeleton />;
  const total = data.quiz.totalPoints;
  const out = (n: number | null) => (n === null ? '–' : `${n} / ${total}`);
  const pct = (n: number) => (total ? Math.round((n * 100) / total) : 0);
  const label: Record<AttemptStatus, string> = {
    submitted: q.submitted,
    in_progress: q.inProgress,
    timed_out: q.timedOut,
  };

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          [q.submitted, `${data.stats.submitted} / ${data.stats.students}`],
          [q.average, out(data.stats.average)],
          [q.highest, out(data.stats.highest)],
          [q.lowest, out(data.stats.lowest)],
          [q.toMark, String(data.stats.toMark)],
        ].map(([k, v]) => (
          <div key={k} className={`${card} px-4 py-3`}>
            <dt className="text-sm text-ink-subtle">{k}</dt>
            <dd className="font-mono text-lg font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {data.rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">{q.noStudents}</p>
      ) : (
        <section className="space-y-2">
          <div className="flex justify-end">
            <a href={`/api/v1${url}/results.csv`} download className={btn('secondary')}>
              <Download aria-hidden className="size-4" />
              {q.exportCsv}
            </a>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead className="bg-surface-soft text-left text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.students.number}</th>
                  <th className="px-3 py-2 font-medium">{q.student}</th>
                  <th className="px-3 py-2 font-medium">{t.students.status}</th>
                  <th className="px-3 py-2 text-right font-medium">{q.score}</th>
                  <th className="px-3 py-2 text-right font-medium">{q.percent}</th>
                  <th className="px-3 py-2 text-right font-medium">{q.rank}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line [&>tr:hover]:bg-surface-soft/60">
                {data.rows.map((r) => {
                  const done = r.status && r.status !== 'in_progress';
                  const final = done && r.marked && r.score !== null;
                  return (
                    <tr key={r.studentId}>
                      <td className="px-3 py-2 font-mono text-ink-subtle">{r.studentNumber}</td>
                      <td className="px-3 py-2">{r.fullName}</td>
                      <td className="px-3 py-2">
                        {done && !r.marked ? (
                          <Badge status="pending">{q.waitingMarks}</Badge>
                        ) : r.status ? (
                          <Badge tone={ATTEMPT_TONE[r.status]}>{label[r.status]}</Badge>
                        ) : (
                          <Badge tone="neutral">{q.notStarted}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {done ? `${r.score}${r.marked ? '' : ' + ?'} / ${total}` : '–'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {final ? `${pct(r.score!)}%` : '–'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.rank ? `${r.rank} / ${data.stats.ranked}` : '–'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {final &&
                          r.guardians.map((g) => (
                            <a
                              key={g.phone}
                              href={waLink(
                                g.phone,
                                fmt(q.resultMessage, {
                                  student: r.fullName,
                                  score: r.score!,
                                  total,
                                  percent: pct(r.score!),
                                  quiz: data.quiz.title,
                                  rank: r.rank ?? '–',
                                  of: data.stats.ranked,
                                  institute: tenant.name,
                                }),
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className={`${btn('whatsapp', 'xs')} ml-1`}
                            >
                              <MessageCircle aria-hidden className="size-3.5" />
                              {fmt(q.sendResult, { name: g.fullName })}
                            </a>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.stats.submitted > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">{q.perQuestion}</h2>
          <ol className="grid gap-3 xl:grid-cols-2">
            {data.questions.map((x, i) => (
              <li key={x.id} className={`${card} space-y-2 p-4 text-sm`}>
                <p className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="text-ink-subtle">{fmt(q.question, { n: i + 1 })} · </span>
                    <span className="whitespace-pre-line">{x.body}</span>
                  </span>
                  <span className="shrink-0 font-mono">
                    {x.average === null
                      ? '–'
                      : fmt(q.averageOf, { n: x.average, points: x.points })}
                  </span>
                </p>
                <p className="text-ink-subtle">
                  {fmt(q.answeredN, { n: x.answered })} · {fmt(q.fullMarksN, { n: x.fullMarks })}
                </p>
                {isAuto(x.type) && (
                  // How many picked each answer: a popular wrong answer points to a wrong key or
                  // a misunderstanding worth explaining in class.
                  <ul className="space-y-1">
                    {x.options.map((o, j) => {
                      const share = data.stats.submitted
                        ? (o.picks * 100) / data.stats.submitted
                        : 0;
                      return (
                        <li key={o.id} className="flex items-center gap-2">
                          <span className="w-4 font-mono text-ink-muted">{LETTERS[j]}</span>
                          <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-surface-soft">
                            <span
                              className={`absolute inset-y-0 left-0 ${o.isCorrect ? 'bg-success-soft' : 'bg-primary-soft'}`}
                              style={{ width: `${share}%` }}
                            />
                            <span className="relative flex h-full items-center gap-1.5 truncate px-2">
                              {o.isCorrect && (
                                <CircleCheck
                                  aria-label={q.correct}
                                  className="size-3.5 shrink-0 text-success"
                                />
                              )}
                              {o.body}
                            </span>
                          </span>
                          <span className="w-20 text-right font-mono text-ink-muted">
                            {fmt(q.pickedN, { n: o.picks })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
