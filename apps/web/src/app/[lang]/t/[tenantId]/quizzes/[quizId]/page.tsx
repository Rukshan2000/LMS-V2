import { Locked } from '@/components/locked';
import { QuizEditor } from '@/components/quizzes/quiz-editor';

// Data loads in the browser after the dashboard shell resolves the session.
export const instant = false;

export default function Page() {
  return (
    <Locked feature="quizzes">
      <QuizEditor />
    </Locked>
  );
}
