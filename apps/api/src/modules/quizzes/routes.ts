import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError, notFound } from '../../lib/http-error.js';
import { toCsv } from '../../lib/csv.js';
import { colomboToday, TIME_ZONE } from '../../lib/time.js';
import { isAuto, markAnswer, shuffle, type MultiScoring, type QuestionType } from './marking.js';

// Online quizzes (docs/QUIZ_PLAN.md). Phase 1: MCQ and multiple-answer questions, marked on
// submit. The server owns the clock: answers are refused after deadline + GRACE_SECONDS.

const GRACE_SECONDS = 30;
const uuid = z.uuid();
const config = { feature: 'quizzes' as const };

const param = (req: FastifyRequest, name: string) => {
  const value = (req.params as Record<string, string>)[name];
  if (!uuid.safeParse(value).success) throw notFound();
  return value!;
};

const settingsShape = {
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(5000).nullish(),
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }),
  timeLimitMinutes: z.number().int().min(1).max(1440).nullish(),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  showCorrect: z.boolean().default(true),
  showExplanations: z.boolean().default(true),
  requirePaid: z.boolean().default(false),
  autoRelease: z.enum(['off', 'on_submit', 'on_close']).default('on_close'),
};
const settings = z.object(settingsShape).refine((s) => new Date(s.closesAt) > new Date(s.opensAt), {
  message: 'Close time must be after open time',
  path: ['closesAt'],
});

/** Longest typed answer per type. */
const TEXT_MAX = { short: 500, essay: 20_000 } as const;

const questionsInput = z.object({
  questions: z
    .array(
      z
        .object({
          type: z.enum(['mcq', 'multi', 'short', 'essay']),
          body: z.string().trim().min(1).max(5000),
          explanation: z.string().trim().max(5000).nullish(),
          points: z
            .number()
            .positive()
            .max(999)
            .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'max 2 decimals')
            .default(1),
          multiScoring: z.enum(['all_or_nothing', 'partial']).default('all_or_nothing'),
          options: z
            .array(z.object({ body: z.string().trim().min(1).max(1000), isCorrect: z.boolean() }))
            .max(6)
            .default([]),
        })
        // MCQ needs 2 to 6 answers to choose from; typed questions have none.
        .refine((q) => (isAuto(q.type) ? q.options.length >= 2 : q.options.length === 0), {
          message: 'MCQ needs 2 to 6 answers; typed questions take none',
          path: ['options'],
        }),
    )
    .max(200),
});

const toRow = (s: z.infer<typeof settings>) => ({
  title: s.title,
  instructions: s.instructions || null,
  opens_at: s.opensAt,
  closes_at: s.closesAt,
  time_limit_minutes: s.timeLimitMinutes ?? null,
  shuffle_questions: s.shuffleQuestions,
  shuffle_options: s.shuffleOptions,
  show_correct: s.showCorrect,
  show_explanations: s.showExplanations,
  require_paid: s.requirePaid,
  auto_release: s.autoRelease,
});

const QUIZ_COLUMNS = [
  'q.id',
  'q.batch_id as batchId',
  'b.name as batchName',
  'q.title',
  'q.instructions',
  'q.status',
  'q.opens_at as opensAt',
  'q.closes_at as closesAt',
  'q.time_limit_minutes as timeLimitMinutes',
  'q.shuffle_questions as shuffleQuestions',
  'q.shuffle_options as shuffleOptions',
  'q.show_correct as showCorrect',
  'q.show_explanations as showExplanations',
  'q.require_paid as requirePaid',
  'q.auto_release as autoRelease',
  'q.total_points as totalPoints',
  'q.released_at as releasedAt',
];

type QuizRow = {
  id: string;
  status: 'draft' | 'published' | 'released';
  autoRelease: 'off' | 'on_submit' | 'on_close';
  totalPoints: string | number;
  closed: boolean;
  [key: string]: unknown;
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const withNumbers = <T extends QuizRow>(q: T) => ({ ...q, totalPoints: Number(q.totalPoints) });

/** Owner/admin manage every class's quizzes; a teacher only their own classes'. */
const isManager = (req: FastifyRequest) =>
  req.tenant!.roles.some((r) => r === 'owner' || r === 'admin');
const visible = (req: FastifyRequest) => (q: Knex.QueryBuilder) => {
  if (!isManager(req)) q.where('b.teacher_membership_id', req.tenant!.membershipId);
};

function quizQuery(trx: Knex.Transaction, req: FastifyRequest) {
  return trx('quizzes as q')
    .join('batches as b', 'b.id', 'q.batch_id')
    .modify(visible(req))
    .select(
      ...QUIZ_COLUMNS,
      trx.raw('q.closes_at <= now() AS closed'),
      trx.raw('q.opens_at > now() AS upcoming'),
    );
}

async function getQuiz(trx: Knex.Transaction, req: FastifyRequest, id: string) {
  const quiz = (await quizQuery(trx, req).where('q.id', id).first()) as QuizRow | undefined;
  if (!quiz) throw notFound();
  return quiz;
}

const hasAttempts = async (trx: Knex.Transaction, quizId: string) =>
  !!(await trx('quiz_attempts').where({ quiz_id: quizId }).first('id'));

interface QuizOption {
  id: string;
  body: string;
  isCorrect: boolean;
}
interface QuizQuestion {
  id: string;
  type: QuestionType;
  body: string;
  explanation: string | null;
  points: number;
  multiScoring: MultiScoring;
  options: QuizOption[];
}

/** Questions with options and the answer key, in order (staff only). */
async function loadQuestions(trx: Knex.Transaction, quizId: string): Promise<QuizQuestion[]> {
  const questions = await trx('quiz_questions')
    .where({ quiz_id: quizId })
    .orderBy('position')
    .select('id', 'type', 'body', 'explanation', 'points', 'multi_scoring as multiScoring');
  const options = await trx('quiz_options')
    .whereIn(
      'question_id',
      questions.map((q) => q.id),
    )
    .orderBy('position')
    .select('id', 'question_id as questionId', 'body', 'is_correct as isCorrect');
  return questions.map((q) => ({
    ...q,
    points: Number(q.points),
    options: options
      .filter((o) => o.questionId === q.id)
      .map(({ id, body, isCorrect }) => ({ id, body, isCorrect })),
  }));
}

/** Recompute auto marks for these attempts, then each attempt's total. Keeps teacher marks. */
export async function markAttempts(trx: Knex.Transaction, attemptIds: string[]) {
  if (!attemptIds.length) return;
  const answers = await trx('quiz_answers as a')
    .join('quiz_questions as q', 'q.id', 'a.question_id')
    .whereIn('a.attempt_id', attemptIds)
    .whereNull('a.marked_by_membership_id')
    .select(
      'a.id',
      'a.option_ids as chosen',
      'a.text',
      'q.id as questionId',
      'q.type',
      'q.points',
      'q.multi_scoring as multiScoring',
    );
  const keys = await trx('quiz_options')
    .whereIn('question_id', [...new Set(answers.map((a) => a.questionId))])
    .where('is_correct', true)
    .select('question_id as questionId', 'id');
  const marks = answers.flatMap((a) => {
    // A typed answer left empty scores 0 without the teacher; the rest wait for a mark.
    if (!isAuto(a.type)) return a.text?.trim() ? [] : [[a.id, 0] as const];
    const score = markAnswer(
      {
        type: a.type as QuestionType,
        points: Number(a.points),
        multiScoring: a.multiScoring as MultiScoring,
        correct: keys.filter((k) => k.questionId === a.questionId).map((k) => k.id),
      },
      a.chosen,
    );
    return score === null ? [] : [[a.id, score] as const];
  });
  if (marks.length) {
    await trx.raw(
      `UPDATE quiz_answers a SET score = v.score
       FROM unnest(?::uuid[], ?::numeric[]) AS v(id, score) WHERE a.id = v.id`,
      [marks.map((m) => m[0]), marks.map((m) => m[1])],
    );
  }
  await trx.raw(
    `UPDATE quiz_attempts t SET score = s.total, marked = s.done
     FROM (SELECT attempt_id, coalesce(sum(score), 0) AS total, bool_and(score IS NOT NULL) AS done
           FROM quiz_answers WHERE attempt_id = ANY(?::uuid[]) GROUP BY attempt_id) s
     WHERE t.id = s.attempt_id`,
    [attemptIds],
  );
}

/**
 * Attempts whose time ran out without a submit: close and mark them. Called on every read that
 * shows attempts, so no background job is needed (QUIZ_PLAN §7.3). The partial index keeps it cheap.
 */
async function finalizeExpired(trx: Knex.Transaction) {
  const rows = await trx('quiz_attempts')
    .where('status', 'in_progress')
    .whereRaw(`deadline + interval '${GRACE_SECONDS} seconds' < now()`)
    .update({ status: 'timed_out', submitted_at: trx.ref('deadline') })
    .returning('id');
  await markAttempts(
    trx,
    rows.map((r: { id: string }) => r.id),
  );
}

/**
 * Marks and (if allowed) the key are visible to the student once results are out, and only for
 * a fully marked attempt: a release with answers still to mark shows the marked ones first.
 */
const resultsOut = (quiz: QuizRow, attemptStatus: string, marked: boolean) =>
  attemptStatus !== 'in_progress' &&
  marked &&
  (quiz.status === 'released' ||
    (quiz.autoRelease === 'on_close' && quiz.closed) ||
    quiz.autoRelease === 'on_submit');

const ANSWER_COLUMNS = [
  'ans.id',
  'ans.attempt_id as attemptId',
  'st.full_name as fullName',
  'st.student_number as studentNumber',
  'ans.text',
  'ans.option_ids as chosen',
  'ans.score',
  'ans.comment',
  'ans.marked_by_membership_id as markedBy',
];
/** An answer for the teacher; `byTeacher` = marked by hand, not by the system. */
const answerOut = ({ markedBy, score, ...a }: Record<string, unknown>) => ({
  ...a,
  score: num(score),
  byTeacher: !!markedBy,
});

/** Class rank of each fully marked attempt: 1, 2, 2, 4 for ties. */
async function ranks(trx: Knex.Transaction, quizId: string) {
  const rows = await trx('quiz_attempts')
    .where({ quiz_id: quizId, marked: true })
    .whereNot('status', 'in_progress')
    .select('id', trx.raw('rank() OVER (ORDER BY score DESC)::int AS rank'));
  return { of: rows.length, rank: new Map(rows.map((r) => [r.id as string, r.rank as number])) };
}

/**
 * Every student of the class (and anyone who sat it but has since left) with their attempt and
 * rank, the class figures, and per-question statistics over finished attempts.
 */
async function loadResults(trx: Knex.Transaction, req: FastifyRequest, id: string) {
  await finalizeExpired(trx);
  const quiz = await getQuiz(trx, req, id);
  const rows = await trx('students as st')
    .leftJoin('quiz_attempts as a', (j) =>
      j.on('a.student_id', 'st.id').andOn('a.quiz_id', trx.raw('?', [id])),
    )
    .where((w) =>
      w
        .whereIn(
          'st.id',
          trx('enrollments')
            .where({ batch_id: quiz.batchId, status: 'active' })
            .select('student_id'),
        )
        .orWhereNotNull('a.id'),
    )
    .orderByRaw('lower(st.full_name)')
    .select(
      'st.id as studentId',
      'st.full_name as fullName',
      'st.student_number as studentNumber',
      'a.id as attemptId',
      'a.status',
      'a.score',
      'a.marked',
      'a.started_at as startedAt',
      'a.submitted_at as submittedAt',
      // For "send result to parent" on WhatsApp, like fee reminders.
      trx.raw(`COALESCE((SELECT json_agg(json_build_object('fullName', g.full_name, 'phone', g.phone)
                  ORDER BY g.full_name)
                FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = st.id), '[]') AS guardians`),
    );
  const { of, rank } = await ranks(trx, id);
  const scores = rows
    .filter((r) => r.status && r.status !== 'in_progress')
    .map((r) => Number(r.score));
  const round = (n: number) => Math.round(n * 100) / 100;
  const { toMark } = await trx('quiz_answers as ans')
    .join('quiz_attempts as a', 'a.id', 'ans.attempt_id')
    .where('a.quiz_id', id)
    .whereNot('a.status', 'in_progress')
    .whereNull('ans.score')
    .first(trx.raw('count(*)::int AS "toMark"'));

  // Per question: how many answered, average mark, how many got full marks, picks per option.
  const finished = trx('quiz_attempts')
    .where({ quiz_id: id })
    .whereNot('status', 'in_progress')
    .select('id');
  const perQuestion = await trx('quiz_answers as ans')
    .join('quiz_questions as qq', 'qq.id', 'ans.question_id')
    .whereIn('ans.attempt_id', finished)
    .groupBy('ans.question_id')
    .select(
      'ans.question_id as questionId',
      trx.raw(`count(*) FILTER (WHERE cardinality(ans.option_ids) > 0
                 OR coalesce(trim(ans.text), '') <> '')::int AS answered`),
      trx.raw('avg(ans.score)::float AS average'),
      trx.raw('count(*) FILTER (WHERE ans.score = qq.points)::int AS "fullMarks"'),
    );
  const picks = await trx('quiz_answers as ans')
    .whereIn('ans.attempt_id', finished)
    .select(trx.raw('unnest(ans.option_ids) AS "optionId"'), trx.raw('count(*)::int AS picks'))
    .groupByRaw('1');
  const pickCount = new Map(picks.map((p) => [p.optionId as string, p.picks as number]));
  const statsOf = new Map(perQuestion.map((p) => [p.questionId as string, p]));
  const questions = (await loadQuestions(trx, id)).map((q) => {
    const stat = statsOf.get(q.id);
    return {
      id: q.id,
      type: q.type,
      body: q.body,
      points: q.points,
      answered: stat?.answered ?? 0,
      average: stat?.average === null || stat?.average === undefined ? null : round(stat.average),
      fullMarks: stat?.fullMarks ?? 0,
      options: q.options.map((o) => ({ ...o, picks: pickCount.get(o.id) ?? 0 })),
    };
  });

  return {
    quiz: withNumbers(quiz),
    rows: rows.map((r) => ({
      ...r,
      score: num(r.score),
      rank: (r.attemptId && rank.get(r.attemptId)) ?? null,
    })),
    stats: {
      students: rows.length,
      submitted: scores.length,
      inProgress: rows.filter((r) => r.status === 'in_progress').length,
      average: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      toMark,
      ranked: of,
    },
    questions,
  };
}

/** Prefix /api/v1/tenants/:tenantId */
export default async function quizRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.loadTenant);
  const staff = app.requireRole('owner', 'admin', 'teacher');
  const family = app.requireRole('student', 'parent');
  const student = app.requireRole('student');

  // ---- Teacher: authoring ----------------------------------------------------------

  app.get('/quizzes', { preHandler: staff, config }, async (req) => {
    const { batchId } = z.object({ batchId: uuid.optional() }).parse(req.query);
    const quizzes = await req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      return quizQuery(trx, req)
        .modify((q) => batchId && q.where('q.batch_id', batchId))
        .select(
          trx.raw('(SELECT count(*)::int FROM quiz_questions WHERE quiz_id = q.id) AS questions'),
          trx.raw(`(SELECT count(*)::int FROM quiz_attempts
                    WHERE quiz_id = q.id AND status <> 'in_progress') AS submitted`),
          trx.raw(`(SELECT count(*)::int FROM quiz_attempts
                    WHERE quiz_id = q.id AND status = 'in_progress') AS "inProgress"`),
        )
        .orderBy('q.opens_at', 'desc');
    });
    return { quizzes: quizzes.map(withNumbers) };
  });

  app.post('/quizzes', { preHandler: staff, config }, async (req, reply) => {
    const body = settings.and(z.object({ batchId: uuid })).parse(req.body);
    const quiz = await req.withTenant(async (trx) => {
      const batch = await trx('batches as b')
        .where({ 'b.id': body.batchId, 'b.status': 'active' })
        .modify(visible(req))
        .first('b.id');
      if (!batch) throw new HttpError(400, 'invalid_reference', 'Unknown class');
      const [row] = await trx('quizzes')
        .insert({
          ...toRow(body),
          tenant_id: req.tenant!.id,
          batch_id: body.batchId,
          created_by_membership_id: req.tenant!.membershipId,
        })
        .returning('id');
      return getQuiz(trx, req, row.id);
    });
    return reply.status(201).send({ quiz: withNumbers(quiz) });
  });

  app.get('/quizzes/:quizId', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    return req.withTenant(async (trx) => {
      const quiz = await getQuiz(trx, req, id);
      return {
        quiz: { ...withNumbers(quiz), started: await hasAttempts(trx, id) },
        questions: await loadQuestions(trx, id),
      };
    });
  });

  app.patch('/quizzes/:quizId', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const patch = z.object(settingsShape).partial().parse(req.body);
    const quiz = await req.withTenant(async (trx) => {
      const current = await getQuiz(trx, req, id);
      // Validate the merged result, so partial edits still keep close > open.
      const merged = settings.parse({
        ...current,
        opensAt: (current.opensAt as Date).toISOString(),
        closesAt: (current.closesAt as Date).toISOString(),
        ...patch,
      });
      await trx('quizzes')
        .where({ id })
        .update({ ...toRow(merged), updated_at: trx.fn.now() });
      return getQuiz(trx, req, id);
    });
    return { quiz: withNumbers(quiz) };
  });

  app.delete('/quizzes/:quizId', { preHandler: staff, config }, async (req, reply) => {
    const id = param(req, 'quizId');
    await req.withTenant(async (trx) => {
      await getQuiz(trx, req, id);
      if (await hasAttempts(trx, id)) {
        throw new HttpError(409, 'quiz_started', 'Students have already started this quiz');
      }
      await trx('quizzes').where({ id }).delete();
    });
    return reply.status(204).send();
  });

  // Replace the whole question list (the builder saves it in one go). Locked once anyone started.
  app.put('/quizzes/:quizId/questions', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const { questions } = questionsInput.parse(req.body);
    return req.withTenant(async (trx) => {
      await getQuiz(trx, req, id);
      if (await hasAttempts(trx, id)) {
        throw new HttpError(409, 'quiz_started', 'Students have already started this quiz');
      }
      await trx('quiz_questions').where({ quiz_id: id }).delete();
      for (const [position, q] of questions.entries()) {
        const [row] = await trx('quiz_questions')
          .insert({
            tenant_id: req.tenant!.id,
            quiz_id: id,
            position,
            type: q.type,
            body: q.body,
            explanation: q.explanation || null,
            points: q.points,
            multi_scoring: q.multiScoring,
          })
          .returning('id');
        // Typed questions have no options (and Knex refuses an empty insert).
        if (q.options.length) {
          await trx('quiz_options').insert(
            q.options.map((o, i) => ({
              tenant_id: req.tenant!.id,
              question_id: row.id,
              position: i,
              body: o.body,
              is_correct: o.isCorrect,
            })),
          );
        }
      }
      await trx('quizzes')
        .where({ id })
        .update({
          total_points: questions.reduce((sum, q) => sum + q.points, 0),
          updated_at: trx.fn.now(),
        });
      return { questions: await loadQuestions(trx, id) };
    });
  });

  // Fix a wrong answer key, even after students sat the quiz: every finished attempt is re-marked.
  app.put(
    '/quizzes/:quizId/questions/:questionId/key',
    { preHandler: staff, config },
    async (req) => {
      const id = param(req, 'quizId');
      const questionId = param(req, 'questionId');
      const { correct } = z.object({ correct: z.array(uuid).min(1).max(6) }).parse(req.body);
      return req.withTenant(async (trx) => {
        await getQuiz(trx, req, id);
        const question = await trx('quiz_questions')
          .where({ id: questionId, quiz_id: id })
          .first('type');
        if (!question) throw notFound();
        const options = await trx('quiz_options').where({ question_id: questionId }).pluck('id');
        if (
          correct.some((o) => !options.includes(o)) ||
          (question.type === 'mcq' && correct.length !== 1)
        ) {
          throw new HttpError(400, 'invalid_key', 'Choose the correct option(s) of this question');
        }
        await trx('quiz_options')
          .where({ question_id: questionId })
          .update({ is_correct: trx.raw('id = ANY(?::uuid[])', [correct]) });
        const finished = await trx('quiz_attempts')
          .where({ quiz_id: id })
          .whereNot('status', 'in_progress')
          .pluck('id');
        await markAttempts(trx, finished);
        return { questions: await loadQuestions(trx, id), remarked: finished.length };
      });
    },
  );

  app.post('/quizzes/:quizId/publish', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const quiz = await req.withTenant(async (trx) => {
      const quiz = await getQuiz(trx, req, id);
      if (quiz.status !== 'draft') throw new HttpError(409, 'not_draft', 'Already published');
      const questions = await loadQuestions(trx, id);
      const problems: { code: string; question?: number }[] = [];
      if (!questions.length) problems.push({ code: 'no_questions' });
      questions.forEach((q, i) => {
        const right = q.options.filter((o) => o.isCorrect).length;
        if (isAuto(q.type) && (q.type === 'mcq' ? right !== 1 : right < 1)) {
          problems.push({ code: 'no_key', question: i + 1 });
        }
      });
      if (quiz.closed) problems.push({ code: 'already_closed' });
      if (quiz.autoRelease !== 'off' && questions.some((q) => !isAuto(q.type))) {
        problems.push({ code: 'auto_release_manual' });
      }
      if (problems.length) {
        throw new HttpError(400, 'quiz_incomplete', 'The quiz is not ready', { problems });
      }
      await trx('quizzes').where({ id }).update({ status: 'published', updated_at: trx.fn.now() });
      return getQuiz(trx, req, id);
    });
    return { quiz: withNumbers(quiz) };
  });

  app.post('/quizzes/:quizId/unpublish', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const quiz = await req.withTenant(async (trx) => {
      const quiz = await getQuiz(trx, req, id);
      if (quiz.status !== 'published' || (await hasAttempts(trx, id))) {
        throw new HttpError(409, 'quiz_started', 'Students have already started this quiz');
      }
      await trx('quizzes').where({ id }).update({ status: 'draft', updated_at: trx.fn.now() });
      return getQuiz(trx, req, id);
    });
    return { quiz: withNumbers(quiz) };
  });

  for (const [action, from, to] of [
    ['release', 'published', 'released'],
    ['unrelease', 'released', 'published'],
  ] as const) {
    app.post(`/quizzes/:quizId/${action}`, { preHandler: staff, config }, async (req) => {
      const id = param(req, 'quizId');
      const quiz = await req.withTenant(async (trx) => {
        const quiz = await getQuiz(trx, req, id);
        if (quiz.status !== from) throw new HttpError(409, 'wrong_status', `Quiz is not ${from}`);
        // Answers still to mark: ask first. Released anyway, those attempts stay hidden until marked.
        if (action === 'release') {
          await finalizeExpired(trx);
          const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
          const { count } = await trx('quiz_attempts')
            .where({ quiz_id: id, marked: false })
            .whereNot('status', 'in_progress')
            .first(trx.raw('count(*)::int AS count'));
          if (count && !force) {
            throw new HttpError(409, 'unmarked', 'Some answers are not marked yet', { count });
          }
        }
        await trx('quizzes')
          .where({ id })
          .update({
            status: to,
            released_at: to === 'released' ? trx.fn.now() : null,
            updated_at: trx.fn.now(),
          });
        return getQuiz(trx, req, id);
      });
      return { quiz: withNumbers(quiz) };
    });
  }

  app.get('/quizzes/:quizId/results', { preHandler: staff, config }, async (req) =>
    req.withTenant((trx) => loadResults(trx, req, param(req, 'quizId'))),
  );

  // Excel-friendly export of the results table.
  app.get('/quizzes/:quizId/results.csv', { preHandler: staff, config }, async (req, reply) => {
    const { quiz, rows } = await req.withTenant((trx) =>
      loadResults(trx, req, param(req, 'quizId')),
    );
    const pct = (n: number) => (quiz.totalPoints ? Math.round((n * 100) / quiz.totalPoints) : '');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="quiz-results-${colomboToday()}.csv"`)
      .send(
        toCsv([
          ['No.', 'Name', 'Status', 'Marks', 'Out of', '%', 'Rank'],
          ...rows.map((r) => [
            r.studentNumber,
            r.fullName,
            !r.status ? 'not started' : r.marked ? r.status : 'to mark',
            r.score,
            quiz.totalPoints,
            r.score === null || !r.marked ? '' : pct(r.score),
            r.rank,
          ]),
        ]),
      );
  });

  // Copy a quiz (settings and questions) as a new draft, for another class or next year.
  app.post('/quizzes/:quizId/duplicate', { preHandler: staff, config }, async (req, reply) => {
    const id = param(req, 'quizId');
    const { batchId } = z.object({ batchId: uuid.optional() }).parse(req.body ?? {});
    const quiz = await req.withTenant(async (trx) => {
      const source = await getQuiz(trx, req, id);
      const target = batchId ?? (source.batchId as string);
      const batch = await trx('batches as b')
        .where({ 'b.id': target, 'b.status': 'active' })
        .modify(visible(req))
        .first('b.id');
      if (!batch) throw new HttpError(400, 'invalid_reference', 'Unknown class');
      const row = await trx('quizzes').where({ id }).first();
      const [copy] = await trx('quizzes')
        .insert({
          ...row,
          id: undefined,
          batch_id: target,
          status: 'draft',
          released_at: null,
          created_by_membership_id: req.tenant!.membershipId,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('id');
      for (const q of await trx('quiz_questions').where({ quiz_id: id }).orderBy('position')) {
        const [newQ] = await trx('quiz_questions')
          .insert({ ...q, id: undefined, quiz_id: copy.id })
          .returning('id');
        const options = await trx('quiz_options').where({ question_id: q.id });
        if (options.length) {
          await trx('quiz_options').insert(
            options.map((o) => ({ ...o, id: undefined, question_id: newQ.id })),
          );
        }
      }
      return getQuiz(trx, req, copy.id);
    });
    return reply.status(201).send({ quiz: withNumbers(quiz) });
  });

  // ---- Teacher: marking -----------------------------------------------------------

  // What is left to mark, per question and per student.
  app.get('/quizzes/:quizId/marking', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    return req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      await getQuiz(trx, req, id);
      const questions = await trx('quiz_questions as qq')
        .where('qq.quiz_id', id)
        .orderBy('qq.position')
        .select(
          'qq.id',
          'qq.type',
          'qq.body',
          'qq.points',
          trx.raw(`(SELECT count(*)::int FROM quiz_answers ans
                      JOIN quiz_attempts a ON a.id = ans.attempt_id
                    WHERE ans.question_id = qq.id AND a.status <> 'in_progress'
                      AND ans.score IS NULL) AS "toMark"`),
        );
      const attempts = await trx('quiz_attempts as a')
        .join('students as st', 'st.id', 'a.student_id')
        .where('a.quiz_id', id)
        .whereNot('a.status', 'in_progress')
        .orderByRaw('lower(st.full_name)')
        .select(
          'a.id',
          'a.marked',
          'a.score',
          'st.full_name as fullName',
          'st.student_number as studentNumber',
        );
      return {
        questions: questions.map((q) => ({ ...q, points: Number(q.points) })),
        attempts: attempts.map((a) => ({ ...a, score: num(a.score) })),
      };
    });
  });

  // Every finished answer to one question: mark one question for the whole class.
  app.get('/quizzes/:quizId/marking/:questionId', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const questionId = param(req, 'questionId');
    return req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      await getQuiz(trx, req, id);
      const question = (await loadQuestions(trx, id)).find((q) => q.id === questionId);
      if (!question) throw notFound();
      const answers = await trx('quiz_answers as ans')
        .join('quiz_attempts as a', 'a.id', 'ans.attempt_id')
        .join('students as st', 'st.id', 'a.student_id')
        .where({ 'ans.question_id': questionId, 'a.quiz_id': id })
        .whereNot('a.status', 'in_progress')
        .orderBy('a.submitted_at')
        .select(ANSWER_COLUMNS);
      return { question, answers: answers.map(answerOut) };
    });
  });

  // One student's whole attempt: mark student by student.
  app.get('/quizzes/:quizId/attempts/:attemptId', { preHandler: staff, config }, async (req) => {
    const id = param(req, 'quizId');
    const attemptId = param(req, 'attemptId');
    return req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      await getQuiz(trx, req, id);
      const attempt = await trx('quiz_attempts as a')
        .join('students as st', 'st.id', 'a.student_id')
        .where({ 'a.id': attemptId, 'a.quiz_id': id })
        .first(
          'a.id',
          'a.status',
          'a.score',
          'a.marked',
          'a.submitted_at as submittedAt',
          'st.full_name as fullName',
          'st.student_number as studentNumber',
        );
      if (!attempt) throw notFound();
      const answers = await trx('quiz_answers as ans')
        .join('quiz_attempts as a', 'a.id', 'ans.attempt_id')
        .join('students as st', 'st.id', 'a.student_id')
        .where('ans.attempt_id', attemptId)
        .select([...ANSWER_COLUMNS, 'ans.question_id as questionId']);
      const byQuestion = new Map(answers.map((a) => [a.questionId, answerOut(a)]));
      return {
        attempt: { ...attempt, score: num(attempt.score) },
        questions: (await loadQuestions(trx, id)).map((q) => ({
          ...q,
          answer: byQuestion.get(q.id) ?? null,
        })),
      };
    });
  });

  // Mark one answer. Also overrides an auto mark; a later key fix then leaves it alone.
  app.patch('/quiz-answers/:answerId', { preHandler: staff, config }, async (req) => {
    const answerId = param(req, 'answerId');
    const body = z
      .object({
        score: z
          .number()
          .min(0)
          .max(999)
          .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'max 2 decimals'),
        comment: z.string().trim().max(2000).nullish(),
      })
      .parse(req.body);
    return req.withTenant(async (trx) => {
      const row = await trx('quiz_answers as ans')
        .join('quiz_attempts as a', 'a.id', 'ans.attempt_id')
        .join('quiz_questions as qq', 'qq.id', 'ans.question_id')
        .join('quizzes as q', 'q.id', 'a.quiz_id')
        .join('batches as b', 'b.id', 'q.batch_id')
        .where('ans.id', answerId)
        .modify(visible(req))
        .first('ans.attempt_id as attemptId', 'a.status', 'qq.points');
      if (!row) throw notFound();
      if (row.status === 'in_progress') {
        throw new HttpError(409, 'attempt_open', 'The student is still answering');
      }
      if (body.score > Number(row.points)) {
        throw new HttpError(400, 'score_too_high', 'More than this question is worth', {
          points: Number(row.points),
        });
      }
      await trx('quiz_answers')
        .where({ id: answerId })
        .update({
          score: body.score,
          comment: body.comment || null,
          marked_by_membership_id: req.tenant!.membershipId,
          marked_at: trx.fn.now(),
        });
      await markAttempts(trx, [row.attemptId]);
      const attempt = await trx('quiz_attempts')
        .where({ id: row.attemptId })
        .first('score', 'marked');
      return { attempt: { score: num(attempt.score), marked: attempt.marked } };
    });
  });

  // ---- Students and parents ---------------------------------------------------------

  // Published quizzes of the linked students' classes, with their attempt and (when out) marks.
  app.get('/portal/quizzes', { preHandler: family, config }, async (req) => {
    const quizzes = await req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      const rows = await trx('portal_access as pa')
        .join('students as st', 'st.id', 'pa.student_id')
        .joinRaw('CROSS JOIN quizzes AS q')
        .whereIn('q.status', ['published', 'released'])
        .whereRaw(
          `(q.batch_id IN (SELECT batch_id FROM enrollments e
              WHERE e.student_id = st.id AND e.status = 'active')
            OR EXISTS (SELECT 1 FROM quiz_attempts x WHERE x.quiz_id = q.id AND x.student_id = st.id))`,
        )
        .join('batches as b', 'b.id', 'q.batch_id')
        .leftJoin('quiz_attempts as a', (j) =>
          j.on('a.quiz_id', 'q.id').andOn('a.student_id', 'st.id'),
        )
        .where('pa.membership_id', req.tenant!.membershipId)
        .orderBy('q.opens_at', 'desc')
        .select(
          ...QUIZ_COLUMNS,
          trx.raw('q.closes_at <= now() AS closed'),
          trx.raw('q.opens_at > now() AS upcoming'),
          'st.id as studentId',
          'st.full_name as studentName',
          'a.id as attemptId',
          'a.status as attemptStatus',
          'a.score',
          'a.marked',
          'a.deadline',
        );
      return rows.map((r) => {
        const out = r.attemptStatus && resultsOut(r, r.attemptStatus, r.marked);
        return {
          id: r.id,
          title: r.title,
          batchName: r.batchName,
          opensAt: r.opensAt,
          closesAt: r.closesAt,
          timeLimitMinutes: r.timeLimitMinutes,
          totalPoints: Number(r.totalPoints),
          requirePaid: r.requirePaid,
          closed: r.closed,
          upcoming: r.upcoming,
          studentId: r.studentId,
          studentName: r.studentName,
          attempt: r.attemptId
            ? {
                id: r.attemptId,
                status: r.attemptStatus,
                deadline: r.deadline,
                resultsOut: !!out,
                score: out ? num(r.score) : null,
              }
            : null,
        };
      });
    });
    return { quizzes };
  });

  app.post('/portal/quizzes/:quizId/start', { preHandler: student, config }, async (req) => {
    const id = param(req, 'quizId');
    const attemptId = await req.withTenant(async (trx) => {
      const access = await trx('portal_access')
        .where({ membership_id: req.tenant!.membershipId })
        .first('student_id');
      if (!access) throw notFound();
      const studentId = access.student_id as string;
      const quiz = await trx('quizzes as q')
        .where({ 'q.id': id, 'q.status': 'published' })
        .whereIn(
          'q.batch_id',
          trx('enrollments').where({ student_id: studentId, status: 'active' }).select('batch_id'),
        )
        .first(
          'q.time_limit_minutes as timeLimit',
          'q.shuffle_questions as shuffleQuestions',
          'q.shuffle_options as shuffleOptions',
          'q.require_paid as requirePaid',
          trx.raw('now() >= q.opens_at AND now() < q.closes_at AS open'),
        );
      if (!quiz) throw notFound();
      const existing = await trx('quiz_attempts')
        .where({ quiz_id: id, student_id: studentId })
        .first('id');
      if (existing) return existing.id as string;
      if (!quiz.open) throw new HttpError(409, 'quiz_not_open', 'This quiz is not open now');
      if (quiz.requirePaid) {
        const due = await trx('invoices')
          .where({ student_id: studentId })
          .whereIn('status', ['issued', 'part_paid'])
          .whereRaw(`period = to_char(now() AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM')`)
          .first('id');
        if (due) throw new HttpError(403, 'fee_due', 'Pay this month’s fee to start this quiz');
      }
      const questions = await trx('quiz_questions')
        .where({ quiz_id: id })
        .orderBy('position')
        .pluck('id');
      const options = await trx('quiz_options')
        .whereIn('question_id', questions)
        .orderBy('position')
        .select('question_id as questionId', 'id');
      const [row] = await trx('quiz_attempts')
        .insert({
          tenant_id: req.tenant!.id,
          quiz_id: id,
          student_id: studentId,
          membership_id: req.tenant!.membershipId,
          // A late start gets less time: the quiz still closes at closes_at.
          deadline: trx.raw(
            `LEAST(now() + make_interval(mins => ?), (SELECT closes_at FROM quizzes WHERE id = ?))`,
            [quiz.timeLimit ?? 1_000_000, id],
          ),
          question_order: quiz.shuffleQuestions ? shuffle(questions) : questions,
        })
        .onConflict(['tenant_id', 'quiz_id', 'student_id'])
        .ignore()
        .returning('id');
      // A double tap on two devices: the other request created it first.
      if (!row) {
        return (
          await trx('quiz_attempts').where({ quiz_id: id, student_id: studentId }).first('id')
        ).id as string;
      }
      await trx('quiz_answers').insert(
        questions.map((questionId) => {
          const order = options.filter((o) => o.questionId === questionId).map((o) => o.id);
          return {
            tenant_id: req.tenant!.id,
            attempt_id: row.id,
            question_id: questionId,
            option_order: quiz.shuffleOptions ? shuffle(order) : order,
          };
        }),
      );
      return row.id as string;
    });
    return { attemptId };
  });

  // The attempt as the student sees it. Never includes the key before results are out.
  app.get('/portal/attempts/:attemptId', { preHandler: family, config }, async (req) => {
    const id = param(req, 'attemptId');
    return req.withTenant(async (trx) => {
      await finalizeExpired(trx);
      const attempt = await trx('quiz_attempts as a')
        .join('portal_access as pa', (j) =>
          j
            .on('pa.student_id', 'a.student_id')
            .andOn('pa.membership_id', trx.raw('?', [req.tenant!.membershipId])),
        )
        .where('a.id', id)
        .first(
          'a.id',
          'a.quiz_id as quizId',
          'a.membership_id as membershipId',
          'a.status',
          'a.started_at as startedAt',
          'a.deadline',
          'a.submitted_at as submittedAt',
          'a.score',
          'a.marked',
          'a.question_order as questionOrder',
          trx.raw('now() AS now'),
        );
      if (!attempt) throw notFound();
      const quiz = (await trx('quizzes as q')
        .join('batches as b', 'b.id', 'q.batch_id')
        .where('q.id', attempt.quizId)
        .first(...QUIZ_COLUMNS, trx.raw('q.closes_at <= now() AS closed'))) as QuizRow;
      const out = resultsOut(quiz, attempt.status, attempt.marked);
      // A parent only sees an attempt once marks are out; while it runs it is the student's.
      if (attempt.membershipId !== req.tenant!.membershipId && !out) throw notFound();
      const questions = await trx('quiz_answers as ans')
        .join('quiz_questions as qq', 'qq.id', 'ans.question_id')
        .where('ans.attempt_id', id)
        .select(
          'qq.id',
          'qq.type',
          'qq.body',
          'qq.points',
          'qq.explanation',
          'ans.option_ids as chosen',
          'ans.text',
          'ans.option_order as optionOrder',
          'ans.score',
          'ans.comment',
        );
      const options = await trx('quiz_options')
        .whereIn(
          'question_id',
          questions.map((q) => q.id),
        )
        .select('id', 'body', 'is_correct as isCorrect');
      const byId = new Map(options.map((o) => [o.id, o]));
      const order = attempt.questionOrder as string[];
      questions.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      const showKey = out && (quiz.showCorrect as boolean);
      return {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          instructions: quiz.instructions,
          batchName: quiz.batchName,
          totalPoints: Number(quiz.totalPoints),
        },
        attempt: {
          id: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          deadline: attempt.deadline,
          submittedAt: attempt.submittedAt,
          now: attempt.now,
          resultsOut: out,
          score: out ? num(attempt.score) : null,
          ...(out
            ? await ranks(trx, attempt.quizId).then((r) => ({
                rank: r.rank.get(attempt.id) ?? null,
                of: r.of,
              }))
            : {}),
        },
        questions: questions.map((q) => ({
          id: q.id,
          type: q.type,
          body: q.body,
          points: Number(q.points),
          chosen: q.chosen,
          text: q.text,
          options: (q.optionOrder as string[]).map((oid) => {
            const o = byId.get(oid)!;
            return showKey
              ? { id: o.id, body: o.body, correct: o.isCorrect }
              : { id: o.id, body: o.body };
          }),
          ...(out ? { score: num(q.score), comment: q.comment } : {}),
          ...(out && quiz.showExplanations ? { explanation: q.explanation } : {}),
        })),
      };
    });
  });

  app.put(
    '/portal/attempts/:attemptId/answers/:questionId',
    { preHandler: student, config },
    async (req, reply) => {
      const id = param(req, 'attemptId');
      const questionId = param(req, 'questionId');
      const body = z
        .object({
          optionIds: z.array(uuid).max(6).optional(),
          text: z.string().max(TEXT_MAX.essay).optional(),
        })
        .parse(req.body);
      await req.withTenant(async (trx) => {
        const attempt = await trx('quiz_attempts')
          .where({ id, membership_id: req.tenant!.membershipId })
          .first(
            'status',
            trx.raw(`now() <= deadline + interval '${GRACE_SECONDS} seconds' AS "inTime"`),
          );
        if (!attempt) throw notFound();
        if (attempt.status !== 'in_progress' || !attempt.inTime) {
          throw new HttpError(409, 'time_up', 'Time is up for this quiz');
        }
        const answer = await trx('quiz_answers as a')
          .join('quiz_questions as q', 'q.id', 'a.question_id')
          .where({ 'a.attempt_id': id, 'a.question_id': questionId })
          .first('a.id', 'a.option_order as optionOrder', 'q.type');
        if (!answer) throw notFound();
        const invalid = () =>
          new HttpError(400, 'invalid_answer', 'This answer does not fit the question');
        if (isAuto(answer.type)) {
          const unique = [...new Set(body.optionIds ?? [])];
          if (
            body.text !== undefined ||
            unique.some((o) => !answer.optionOrder.includes(o)) ||
            (answer.type === 'mcq' && unique.length > 1)
          ) {
            throw invalid();
          }
          await trx('quiz_answers')
            .where({ id: answer.id })
            .update({ option_ids: unique, saved_at: trx.fn.now() });
        } else {
          const max = TEXT_MAX[answer.type as keyof typeof TEXT_MAX];
          if (body.optionIds !== undefined || body.text === undefined || !max) throw invalid();
          if (body.text.length > max) {
            throw new HttpError(400, 'answer_too_long', 'This answer is too long');
          }
          await trx('quiz_answers')
            .where({ id: answer.id })
            .update({ text: body.text, saved_at: trx.fn.now() });
        }
      });
      return reply.status(204).send();
    },
  );

  app.post(
    '/portal/attempts/:attemptId/submit',
    { preHandler: student, config },
    async (req, reply) => {
      const id = param(req, 'attemptId');
      await req.withTenant(async (trx) => {
        const attempt = await trx('quiz_attempts')
          .where({ id, membership_id: req.tenant!.membershipId })
          .first('status');
        if (!attempt) throw notFound();
        // Already submitted (double tap, or the timer beat the button): nothing to do.
        if (attempt.status !== 'in_progress') return;
        await trx('quiz_attempts')
          .where({ id })
          .update({
            // Past the grace it counts as timed out at the deadline, like the lazy close.
            status: trx.raw(
              `CASE WHEN now() <= deadline + interval '${GRACE_SECONDS} seconds'
               THEN 'submitted' ELSE 'timed_out' END`,
            ),
            submitted_at: trx.raw('LEAST(now(), deadline)'),
          });
        await markAttempts(trx, [id]);
      });
      return reply.status(204).send();
    },
  );
}
