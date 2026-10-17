export type QuizStatus = 'draft' | 'published' | 'released';
export type AutoRelease = 'off' | 'on_submit' | 'on_close';
export type QuestionType = 'mcq' | 'multi' | 'short' | 'essay';
/** MCQ types are marked by the system; typed answers by the teacher. */
export const isAuto = (type: QuestionType) => type === 'mcq' || type === 'multi';

export interface Quiz {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  instructions: string | null;
  status: QuizStatus;
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showCorrect: boolean;
  showExplanations: boolean;
  requirePaid: boolean;
  autoRelease: AutoRelease;
  totalPoints: number;
  closed: boolean;
  upcoming: boolean;
  /** Detail only: a student has started, so questions are locked. */
  started?: boolean;
}

export interface QuizSummary extends Quiz {
  questions: number;
  submitted: number;
  inProgress: number;
}

export interface Question {
  id?: string;
  type: QuestionType;
  body: string;
  explanation: string | null;
  points: number;
  multiScoring: 'all_or_nothing' | 'partial';
  options: { id?: string; body: string; isCorrect: boolean }[];
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'timed_out';

export interface ResultRow {
  studentId: string;
  fullName: string;
  studentNumber: string;
  attemptId: string | null;
  status: AttemptStatus | null;
  score: number | null;
  marked: boolean | null;
  submittedAt: string | null;
  rank: number | null;
  guardians: { fullName: string; phone: string }[];
}

/** Per-question statistics over finished attempts. */
export interface QuestionStat {
  id: string;
  type: QuestionType;
  body: string;
  points: number;
  answered: number;
  average: number | null;
  fullMarks: number;
  options: { id: string; body: string; isCorrect: boolean; picks: number }[];
}

/** An answer as the teacher sees it while marking. */
export interface MarkingAnswer {
  id: string;
  attemptId: string;
  fullName: string;
  studentNumber: string;
  text: string | null;
  chosen: string[];
  score: number | null;
  comment: string | null;
  byTeacher: boolean;
}

/** GET /portal/attempts/:id */
export interface AttemptView {
  quiz: {
    id: string;
    title: string;
    instructions: string | null;
    batchName: string;
    totalPoints: number;
  };
  attempt: {
    id: string;
    status: AttemptStatus;
    deadline: string;
    now: string;
    resultsOut: boolean;
    score: number | null;
    rank?: number | null;
    of?: number;
  };
  questions: {
    id: string;
    type: QuestionType;
    body: string;
    points: number;
    chosen: string[];
    text: string | null;
    options: { id: string; body: string; correct?: boolean }[];
    score?: number | null;
    comment?: string | null;
    explanation?: string | null;
  }[];
}

/** GET /portal/quizzes */
export interface PortalQuiz {
  id: string;
  title: string;
  batchName: string;
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number | null;
  totalPoints: number;
  requirePaid: boolean;
  closed: boolean;
  upcoming: boolean;
  studentId: string;
  studentName: string;
  attempt: {
    id: string;
    status: AttemptStatus;
    resultsOut: boolean;
    score: number | null;
  } | null;
}

export const LETTERS = 'ABCDEF';
