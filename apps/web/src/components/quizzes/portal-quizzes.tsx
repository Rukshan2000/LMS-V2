'use client';

import { Play } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { api, errorMessage, fmt } from '@/lib/api';
import { useTenantData } from '../dashboard-shell';
import { Badge, btn, FormError } from '../ui';
import { when } from './quiz-list';
import type { PortalQuiz } from './types';

/** Quizzes for one child on the portal home: start / continue (students), marks (everyone). */
export function PortalQuizzes({ quizzes }: { quizzes: PortalQuiz[] }) {
  const { lang, t } = useI18n();
  const q = t.quizzes;
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const { roles } = useTenantData();
  const sitter = roles.includes('student');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptUrl = (id: string) => `/${lang}/t/${tenantId}/quizzes/attempt/${id}`;

  async function start(quizId: string) {
    setBusy(quizId);
    setError(null);
    try {
      const { attemptId } = await api<{ attemptId: string }>(
        `/tenants/${tenantId}/portal/quizzes/${quizId}/start`,
        { method: 'POST' },
      );
      router.push(attemptUrl(attemptId));
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(null);
    }
  }

  if (!quizzes.length) return <p className="text-sm text-ink-subtle">{q.noQuizzes}</p>;
  return (
    <>
      <ul className="divide-y divide-line text-sm">
        {quizzes.map((quiz) => {
          const a = quiz.attempt;
          const open = !quiz.upcoming && !quiz.closed;
          return (
            <li key={quiz.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{quiz.title}</span>
                <span className="block text-ink-subtle">
                  {quiz.batchName} ·{' '}
                  {quiz.upcoming
                    ? fmt(q.opensOn, { date: when(quiz.opensAt, t.calendar) })
                    : fmt(q.closesOn, { date: when(quiz.closesAt, t.calendar) })}
                  {quiz.timeLimitMinutes && ` · ${fmt(q.timeLimitN, { n: quiz.timeLimitMinutes })}`}
                </span>
              </span>
              {a?.resultsOut ? (
                <Link href={attemptUrl(a.id)} className={btn('secondary', 'xs')}>
                  <span className="font-mono">
                    {a.score} / {quiz.totalPoints}
                  </span>
                  · {q.seeResult}
                </Link>
              ) : a && a.status !== 'in_progress' ? (
                <Badge status="pending">{q.waiting}</Badge>
              ) : sitter && open ? (
                a ? (
                  <Link href={attemptUrl(a.id)} className={btn('primary', 'xs')}>
                    <Play aria-hidden className="size-3.5" />
                    {q.continue}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={busy === quiz.id}
                    onClick={() => start(quiz.id)}
                    className={btn('primary', 'xs')}
                  >
                    <Play aria-hidden className="size-3.5" />
                    {q.start}
                  </button>
                )
              ) : (
                quiz.closed && <Badge tone="neutral">{q.closed}</Badge>
              )}
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
    </>
  );
}
