import { describe, expect, it } from 'vitest';
import { markAnswer, shuffle } from '../src/modules/quizzes/marking.js';

const mcq = {
  type: 'mcq' as const,
  points: 2,
  multiScoring: 'all_or_nothing' as const,
  correct: ['a'],
};
const multi = (multiScoring: 'all_or_nothing' | 'partial') => ({
  type: 'multi' as const,
  points: 3,
  multiScoring,
  correct: ['a', 'b', 'c'],
});

describe('markAnswer', () => {
  it('mcq: full points only for the one correct option', () => {
    expect(markAnswer(mcq, ['a'])).toBe(2);
    expect(markAnswer(mcq, ['b'])).toBe(0);
    expect(markAnswer(mcq, [])).toBe(0);
    expect(markAnswer(mcq, ['a', 'b'])).toBe(0);
  });

  it('multi all-or-nothing: every right option and no wrong one', () => {
    expect(markAnswer(multi('all_or_nothing'), ['c', 'a', 'b'])).toBe(3);
    expect(markAnswer(multi('all_or_nothing'), ['a', 'b'])).toBe(0);
    expect(markAnswer(multi('all_or_nothing'), ['a', 'b', 'c', 'd'])).toBe(0);
  });

  it('multi partial: right minus wrong over total right, floor 0', () => {
    expect(markAnswer(multi('partial'), ['a', 'b', 'c'])).toBe(3);
    expect(markAnswer(multi('partial'), ['a', 'b'])).toBe(2);
    expect(markAnswer(multi('partial'), ['a', 'd'])).toBe(0);
    expect(markAnswer(multi('partial'), ['a', 'b', 'd'])).toBe(1);
    expect(markAnswer(multi('partial'), ['d', 'e'])).toBe(0);
    expect(markAnswer({ ...multi('partial'), points: 1 }, ['a'])).toBe(0.33);
  });

  it('teacher-marked types return null', () => {
    expect(markAnswer({ ...mcq, type: 'essay' }, [])).toBeNull();
  });
});

describe('shuffle', () => {
  it('keeps every item', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffle(items).sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
