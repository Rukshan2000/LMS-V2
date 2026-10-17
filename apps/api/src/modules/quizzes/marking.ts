// Marking rules (docs/QUIZ_PLAN.md §6). Pure functions: the routes load rows and save results.

export type QuestionType = 'mcq' | 'multi' | 'short' | 'essay';
export type MultiScoring = 'all_or_nothing' | 'partial';

export const AUTO_TYPES: QuestionType[] = ['mcq', 'multi'];
export const isAuto = (type: QuestionType) => AUTO_TYPES.includes(type);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Score for one auto-marked answer, or null when the teacher marks it.
 * mcq: full points for the one correct option. multi: all-or-nothing, or partial =
 * max(0, (right picked − wrong picked) ÷ total right) × points.
 */
export function markAnswer(
  q: { type: QuestionType; points: number; multiScoring: MultiScoring; correct: string[] },
  chosen: string[],
): number | null {
  if (!isAuto(q.type)) return null;
  const correct = new Set(q.correct);
  const picked = new Set(chosen);
  const right = [...picked].filter((id) => correct.has(id)).length;
  const wrong = picked.size - right;
  if (q.type === 'mcq') return picked.size === 1 && right === 1 ? q.points : 0;
  if (correct.size === 0) return 0;
  if (q.multiScoring === 'all_or_nothing') {
    return right === correct.size && wrong === 0 ? q.points : 0;
  }
  return round2(Math.max(0, (right - wrong) / correct.size) * q.points);
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
