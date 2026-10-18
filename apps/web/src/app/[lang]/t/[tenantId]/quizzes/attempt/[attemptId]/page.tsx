import { Locked } from '@/components/locked';
import { TakeQuiz } from '@/components/quizzes/take-quiz';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="quizzes">
      <TakeQuiz />
    </Locked>
  );
}
