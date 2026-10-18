import { Locked } from '@/components/locked';
import { QuizList } from '@/components/quizzes/quiz-list';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="quizzes">
      <QuizList />
    </Locked>
  );
}
