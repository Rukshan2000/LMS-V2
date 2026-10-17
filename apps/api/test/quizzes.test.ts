import { createKnex } from '@lms/db';
import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { colomboToday } from '../src/lib/time.js';
import { provision } from './provision.js';

let app: FastifyInstance;
let appDb: Knex;
let ownerDb: Knex;
let owner: string;
let tenantId: string;
let api: string;
let batchId: string;
let amalId: string;
let amal: string; // student login
let mother: string; // parent login

async function signup(phone: string) {
  await provision(ownerDb, phone);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { phone, password: 'correct-horse', acceptPrivacy: true, fullName: `User ${phone}` },
  });
  return `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
}
const call = (method: string, url: string, payload?: unknown, cookie = owner) =>
  app.inject({
    method: method as 'GET',
    url: url.startsWith('/api') ? url : `${api}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
async function portalLogin(studentId: string, phone: string) {
  const code = (await call('POST', `/students/${studentId}/portal-invite`, { phone })).json().code;
  const cookie = await signup(phone);
  expect((await call('POST', `/api/v1/invites/${code}/accept`, undefined, cookie)).statusCode).toBe(
    200,
  );
  return cookie;
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const QUESTIONS = [
  {
    type: 'mcq',
    body: '2 + 2 = ?',
    explanation: 'Basic addition',
    points: 2,
    options: [
      { body: '3', isCorrect: false },
      { body: '4', isCorrect: true },
      { body: '5', isCorrect: false },
    ],
  },
  {
    type: 'multi',
    body: 'Which are prime?',
    multiScoring: 'partial',
    points: 2,
    options: [
      { body: '2', isCorrect: true },
      { body: '3', isCorrect: true },
      { body: '4', isCorrect: false },
    ],
  },
];

/** A published quiz that is open now, with the two questions above. */
async function openQuiz(extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/quizzes', {
    batchId,
    title: 'Term test 1',
    opensAt: minutes(-5),
    closesAt: minutes(60),
    timeLimitMinutes: 30,
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().quiz.id as string;
  expect((await call('PUT', `/quizzes/${id}/questions`, { questions: QUESTIONS })).statusCode).toBe(
    200,
  );
  expect((await call('POST', `/quizzes/${id}/publish`)).statusCode).toBe(200);
  return id;
}
async function start(quizId: string, cookie = amal) {
  const res = await call('POST', `/portal/quizzes/${quizId}/start`, undefined, cookie);
  expect(res.statusCode).toBe(200);
  const attemptId = res.json().attemptId as string;
  return {
    attemptId,
    view: (await call('GET', `/portal/attempts/${attemptId}`, undefined, cookie)).json(),
  };
}
type Option = { id: string; body: string };
type Question = { id: string; body: string; options: Option[] };
const pick = (q: Question, ...bodies: string[]) =>
  q.options.filter((o) => bodies.includes(o.body)).map((o) => o.id);
const byBody = (view: { questions: Question[] }, body: string) =>
  view.questions.find((q) => q.body === body)!;

beforeAll(async () => {
  appDb = createKnex(process.env.TEST_DATABASE_URL!);
  ownerDb = createKnex(process.env.TEST_MIGRATION_DATABASE_URL!);
  app = await buildApp({ db: appDb, secureCookies: false, authRateLimitMax: 1000, logger: false });
});
afterAll(async () => {
  await app.close();
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

beforeEach(async () => {
  await ownerDb.raw('TRUNCATE tenants, users CASCADE');
  owner = await signup('0770000001');
  tenantId = (
    await call('POST', '/api/v1/tenants', { name: 'Nimal Maths', slug: 'nimal-maths' })
  ).json().tenant.id;
  api = `/api/v1/tenants/${tenantId}`;
  amalId = (
    await call('POST', '/students', {
      fullName: 'Amal',
      phone: '0711111111',
      guardians: [{ fullName: 'Kamala', phone: '0722222222', relationship: 'mother' }],
      force: true,
    })
  ).json().student.id;
  batchId = (await call('POST', '/batches', { name: 'Theory', subjectName: 'Maths' })).json().batch
    .id;
  await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [amalId] });
  amal = await portalLogin(amalId, '0711111111');
  mother = await portalLogin(amalId, '0722222222');
});

describe('quizzes', () => {
  it('a student sits an MCQ quiz: no key while open, marked on submit, shown after release', async () => {
    const quizId = await openQuiz();
    const { attemptId, view } = await start(quizId);

    // The key and explanations never reach the student before results are out.
    expect(JSON.stringify(view)).not.toMatch(/isCorrect|"correct"|explanation|Basic addition/);
    expect(view.attempt).toMatchObject({ status: 'in_progress', resultsOut: false, score: null });
    expect(new Date(view.attempt.deadline).getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);

    const sum = byBody(view, '2 + 2 = ?');
    const primes = byBody(view, 'Which are prime?');
    const save = (q: Question, ids: string[]) =>
      call('PUT', `/portal/attempts/${attemptId}/answers/${q.id}`, { optionIds: ids }, amal);
    expect((await save(sum, pick(sum, '3'))).statusCode).toBe(204);
    expect((await save(sum, pick(sum, '4'))).statusCode).toBe(204); // changed mind: last save wins
    expect((await save(sum, pick(sum, '3', '4'))).statusCode).toBe(400); // mcq takes one option
    expect((await save(primes, pick(primes, '2', '4'))).statusCode).toBe(204);
    expect(
      (await call('POST', `/portal/attempts/${attemptId}/submit`, undefined, amal)).statusCode,
    ).toBe(204);
    expect((await save(sum, pick(sum, '3'))).statusCode).toBe(409);

    // Auto release is "after close" by default: still hidden while the quiz is open.
    let mine = (await call('GET', `/portal/attempts/${attemptId}`, undefined, amal)).json();
    expect(mine.attempt).toMatchObject({ status: 'submitted', resultsOut: false, score: null });
    // The parent sees nothing of the attempt until results are out.
    expect((await call('GET', `/portal/attempts/${attemptId}`, undefined, mother)).statusCode).toBe(
      404,
    );

    // mcq 2/2; multi partial: (1 right − 1 wrong) / 2 right = 0.
    const results = (await call('GET', `/quizzes/${quizId}/results`)).json();
    expect(results.rows[0]).toMatchObject({ fullName: 'Amal', status: 'submitted', score: 2 });
    expect(results.stats).toMatchObject({ submitted: 1, average: 2, highest: 2 });

    expect((await call('POST', `/quizzes/${quizId}/release`)).statusCode).toBe(200);
    mine = (await call('GET', `/portal/attempts/${attemptId}`, undefined, amal)).json();
    expect(mine.attempt).toMatchObject({ resultsOut: true, score: 2 });
    expect(byBody(mine, '2 + 2 = ?')).toMatchObject({ score: 2, explanation: 'Basic addition' });
    expect(byBody(mine, '2 + 2 = ?').options.find((o: Option) => o.body === '4')).toMatchObject({
      correct: true,
    });
    const list = (await call('GET', '/portal/quizzes', undefined, mother)).json().quizzes;
    expect(list).toEqual([
      expect.objectContaining({
        title: 'Term test 1',
        attempt: expect.objectContaining({ score: 2 }),
      }),
    ]);
  });

  it('a wrong answer key can be fixed after students sat it; attempts are re-marked', async () => {
    const quizId = await openQuiz();
    const { attemptId, view } = await start(quizId);
    const sum = byBody(view, '2 + 2 = ?');
    await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${sum.id}`,
      { optionIds: pick(sum, '5') },
      amal,
    );
    await call('POST', `/portal/attempts/${attemptId}/submit`, undefined, amal);
    expect((await call('GET', `/quizzes/${quizId}/results`)).json().rows[0].score).toBe(0);

    // Questions are locked once anyone started; only the key can change.
    expect(
      (await call('PUT', `/quizzes/${quizId}/questions`, { questions: QUESTIONS })).json().code,
    ).toBe('quiz_started');
    const res = await call('PUT', `/quizzes/${quizId}/questions/${sum.id}/key`, {
      correct: pick(sum, '5'),
    });
    expect(res.json().remarked).toBe(1);
    expect((await call('GET', `/quizzes/${quizId}/results`)).json().rows[0].score).toBe(2);
  });

  it('the server owns the clock: late answers are refused and the attempt closes itself', async () => {
    const quizId = await openQuiz();
    const { attemptId, view } = await start(quizId);
    const sum = byBody(view, '2 + 2 = ?');
    await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${sum.id}`,
      { optionIds: pick(sum, '4') },
      amal,
    );
    await ownerDb('quiz_attempts')
      .where({ id: attemptId })
      .update({ deadline: ownerDb.raw("now() - interval '1 minute'") });

    const late = await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${sum.id}`,
      { optionIds: pick(sum, '3') },
      amal,
    );
    expect(late.json().code).toBe('time_up');
    // Nobody pressed Submit: the next read closes and marks it with the saved answer.
    const row = (await call('GET', `/quizzes/${quizId}/results`)).json().rows[0];
    expect(row).toMatchObject({ status: 'timed_out', score: 2 });
  });

  it('one attempt per student; parents and closed quizzes cannot start', async () => {
    const quizId = await openQuiz();
    const first = await start(quizId);
    expect((await start(quizId)).attemptId).toBe(first.attemptId);
    expect(
      (await call('POST', `/portal/quizzes/${quizId}/start`, undefined, mother)).statusCode,
    ).toBe(403);

    const later = await openQuiz({ opensAt: minutes(60), closesAt: minutes(120) });
    expect(
      (await call('POST', `/portal/quizzes/${later}/start`, undefined, amal)).json().code,
    ).toBe('quiz_not_open');
  });

  it('publishing checks the quiz is complete', async () => {
    const id = (
      await call('POST', '/quizzes', {
        batchId,
        title: 'Draft',
        opensAt: minutes(0),
        closesAt: minutes(60),
      })
    ).json().quiz.id;
    let res = await call('POST', `/quizzes/${id}/publish`);
    expect(res.json().details.problems).toEqual([{ code: 'no_questions' }]);
    await call('PUT', `/quizzes/${id}/questions`, {
      questions: [
        {
          ...QUESTIONS[0],
          options: QUESTIONS[0]!.options.map((o) => ({ ...o, isCorrect: false })),
        },
      ],
    });
    res = await call('POST', `/quizzes/${id}/publish`);
    expect(res.json().details.problems).toEqual([{ code: 'no_key', question: 1 }]);
    // Students never see drafts.
    expect((await call('GET', '/portal/quizzes', undefined, amal)).json().quizzes).toEqual([]);
  });

  it('“paid students only” blocks a student with this month’s fee unpaid', async () => {
    await call('PUT', `/batches/${batchId}/fees`, { class: '2500' });
    await call('POST', '/invoices/generate', { period: colomboToday().slice(0, 7) });
    const quizId = await openQuiz({ requirePaid: true });
    const res = await call('POST', `/portal/quizzes/${quizId}/start`, undefined, amal);
    expect(res.json().code).toBe('fee_due');
  });

  it('a teacher manages only their own classes’ quizzes', async () => {
    const quizId = await openQuiz();
    const { code } = (
      await call('POST', '/invites', { fullName: 'Sunil', phone: '0712345678', role: 'teacher' })
    ).json();
    const teacher = await signup('0712345678');
    await call('POST', `/api/v1/invites/${code}/accept`, undefined, teacher);
    expect((await call('GET', `/quizzes/${quizId}`, undefined, teacher)).statusCode).toBe(404);
    expect((await call('GET', '/quizzes', undefined, teacher)).json().quizzes).toEqual([]);

    const members = (await call('GET', '/members')).json().members;
    const sunil = members.find((m: { roles: string[] }) => m.roles.includes('teacher'));
    await call('PATCH', `/batches/${batchId}`, { teacherMembershipId: sunil.membershipId });
    expect((await call('GET', `/quizzes/${quizId}`, undefined, teacher)).statusCode).toBe(200);
  });

  it('needs the quizzes plan feature', async () => {
    const { account_id } = await ownerDb('tenants').where({ id: tenantId }).first('account_id');
    await ownerDb('account_overrides').insert({
      account_id,
      key: 'feature.quizzes',
      value: JSON.stringify(false),
      note: 'test',
    });
    expect((await call('GET', '/quizzes')).json().code).toBe('feature_locked');
  });
});

describe('typed answers and teacher marking', () => {
  const TYPED = [
    QUESTIONS[0],
    { type: 'short', body: 'Name the unit of force', points: 1 },
    { type: 'essay', body: 'Explain Newton’s first law', points: 5 },
    { type: 'short', body: 'Left blank on purpose', points: 1 },
  ];
  async function typedQuiz() {
    const id = (
      await call('POST', '/quizzes', {
        batchId,
        title: 'Physics',
        opensAt: minutes(-5),
        closesAt: minutes(60),
        autoRelease: 'on_close',
      })
    ).json().quiz.id as string;
    expect((await call('PUT', `/quizzes/${id}/questions`, { questions: TYPED })).statusCode).toBe(
      200,
    );
    // Teacher-marked questions cannot release automatically.
    expect((await call('POST', `/quizzes/${id}/publish`)).json().details.problems).toEqual([
      { code: 'auto_release_manual' },
    ]);
    await call('PATCH', `/quizzes/${id}`, { autoRelease: 'off' });
    expect((await call('POST', `/quizzes/${id}/publish`)).statusCode).toBe(200);
    return id;
  }

  it('typed answers wait for the teacher; release shows only fully marked attempts', async () => {
    const quizId = await typedQuiz();
    const { attemptId, view } = await start(quizId);
    const put = (body: string, payload: object) =>
      call('PUT', `/portal/attempts/${attemptId}/answers/${byBody(view, body).id}`, payload, amal);
    expect(
      (await put('2 + 2 = ?', { optionIds: pick(byBody(view, '2 + 2 = ?'), '4') })).statusCode,
    ).toBe(204);
    expect((await put('Name the unit of force', { text: 'Newton' })).statusCode).toBe(204);
    expect((await put('Name the unit of force', { text: 'x'.repeat(501) })).json().code).toBe(
      'answer_too_long',
    );
    expect((await put('Name the unit of force', { optionIds: [] })).json().code).toBe(
      'invalid_answer',
    );
    expect((await put('2 + 2 = ?', { text: '4' })).json().code).toBe('invalid_answer');
    expect(
      (await put('Explain Newton’s first law', { text: 'A body stays at rest…' })).statusCode,
    ).toBe(204);
    await call('POST', `/portal/attempts/${attemptId}/submit`, undefined, amal);

    // MCQ marked, the blank typed answer is 0, two typed answers wait.
    let results = (await call('GET', `/quizzes/${quizId}/results`)).json();
    expect(results.rows[0]).toMatchObject({ score: 2, marked: false });
    expect(results.stats.toMark).toBe(2);
    const marking = (await call('GET', `/quizzes/${quizId}/marking`)).json();
    expect(marking.questions.map((q: { toMark: number }) => q.toMark)).toEqual([0, 1, 1, 0]);

    // Release asks first while answers wait; forced, the unmarked attempt stays hidden.
    expect((await call('POST', `/quizzes/${quizId}/release`)).json()).toMatchObject({
      code: 'unmarked',
      details: { count: 1 },
    });
    expect((await call('POST', `/quizzes/${quizId}/release`, { force: true })).statusCode).toBe(
      200,
    );
    let mine = (await call('GET', `/portal/attempts/${attemptId}`, undefined, amal)).json();
    expect(mine.attempt).toMatchObject({ resultsOut: false, score: null });

    // Mark question by question.
    const short = marking.questions[1].id;
    const answers = (await call('GET', `/quizzes/${quizId}/marking/${short}`)).json().answers;
    expect(answers).toEqual([
      expect.objectContaining({ text: 'Newton', score: null, fullName: 'Amal' }),
    ]);
    const mark = (answerId: string, score: number, comment?: string) =>
      call('PATCH', `/quiz-answers/${answerId}`, { score, comment });
    expect((await mark(answers[0].id, 2)).json().code).toBe('score_too_high');
    expect((await mark(answers[0].id, 1, 'Correct')).json().attempt).toEqual({
      score: 3,
      marked: false,
    });

    // Mark student by student, the essay with half marks.
    const full = (await call('GET', `/quizzes/${quizId}/attempts/${attemptId}`)).json();
    const essay = full.questions.find((q: { type: string }) => q.type === 'essay').answer;
    expect((await mark(essay.id, 3.5, 'Give an example')).json().attempt).toEqual({
      score: 6.5,
      marked: true,
    });

    mine = (await call('GET', `/portal/attempts/${attemptId}`, undefined, amal)).json();
    expect(mine.attempt).toMatchObject({ resultsOut: true, score: 6.5 });
    expect(byBody(mine, 'Explain Newton’s first law')).toMatchObject({
      text: 'A body stays at rest…',
      score: 3.5,
      comment: 'Give an example',
    });
    results = (await call('GET', `/quizzes/${quizId}/results`)).json();
    expect(results.stats).toMatchObject({ toMark: 0, average: 6.5 });
  });

  it('a teacher can override an auto mark, and a key fix keeps it', async () => {
    const quizId = await openQuiz();
    const { attemptId, view } = await start(quizId);
    const sum = byBody(view, '2 + 2 = ?');
    await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${sum.id}`,
      { optionIds: pick(sum, '3') },
      amal,
    );
    // Still answering: nothing to mark yet.
    const full = () => call('GET', `/quizzes/${quizId}/attempts/${attemptId}`);
    const answerId = (await full()).json().questions[0].answer.id;
    expect((await call('PATCH', `/quiz-answers/${answerId}`, { score: 1 })).json().code).toBe(
      'attempt_open',
    );
    await call('POST', `/portal/attempts/${attemptId}/submit`, undefined, amal);
    await call('PATCH', `/quiz-answers/${answerId}`, { score: 1, comment: 'Method was right' });
    await call('PUT', `/quizzes/${quizId}/questions/${sum.id}/key`, { correct: pick(sum, '3') });
    const q = (await full()).json().questions[0];
    expect(q.answer).toMatchObject({ score: 1, byTeacher: true, comment: 'Method was right' });
  });
});

describe('ranks, statistics, export and copies', () => {
  async function sit(quizId: string, cookie: string, sum: string, primes: string[]) {
    const { attemptId, view } = await start(quizId, cookie);
    const s = byBody(view, '2 + 2 = ?');
    const p = byBody(view, 'Which are prime?');
    await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${s.id}`,
      { optionIds: pick(s, sum) },
      cookie,
    );
    await call(
      'PUT',
      `/portal/attempts/${attemptId}/answers/${p.id}`,
      { optionIds: pick(p, ...primes) },
      cookie,
    );
    await call('POST', `/portal/attempts/${attemptId}/submit`, undefined, cookie);
    return attemptId;
  }

  it('ranks ties together, counts picks per answer, and exports CSV', async () => {
    const more = await Promise.all(
      ['0755555551', '0755555552'].map(async (phone, i) => {
        const id = (
          await call('POST', '/students', {
            fullName: `Student ${i}`,
            phone,
            guardians: [
              { fullName: `Parent ${i}`, phone: `07666666${i}${i}`, relationship: 'father' },
            ],
            force: true,
          })
        ).json().student.id;
        await call('POST', `/batches/${batchId}/enrollments`, { studentIds: [id] });
        return portalLogin(id, phone);
      }),
    );
    const quizId = await openQuiz();
    // mcq 2 marks + multi partial 2 marks: Amal 4, Student 0 gets 4 too, Student 1 gets 0.
    const amalAttempt = await sit(quizId, amal, '4', ['2', '3']);
    await sit(quizId, more[0]!, '4', ['2', '3']);
    await sit(quizId, more[1]!, '5', ['4']);

    const results = (await call('GET', `/quizzes/${quizId}/results`)).json();
    const byName = (n: string) => results.rows.find((r: { fullName: string }) => r.fullName === n);
    expect([byName('Amal').rank, byName('Student 0').rank, byName('Student 1').rank]).toEqual([
      1, 1, 3,
    ]);
    expect(byName('Amal').guardians).toEqual([{ fullName: 'Kamala', phone: '94722222222' }]);
    expect(results.stats).toMatchObject({ ranked: 3, average: 2.67, highest: 4, lowest: 0 });
    const sum = results.questions.find((q: { body: string }) => q.body === '2 + 2 = ?');
    expect(sum).toMatchObject({ answered: 3, fullMarks: 2, average: 1.33 });
    expect(
      Object.fromEntries(
        sum.options.map((o: { body: string; picks: number }) => [o.body, o.picks]),
      ),
    ).toEqual({
      '3': 0,
      '4': 2,
      '5': 1,
    });

    const csv = await call('GET', `/quizzes/${quizId}/results.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Amal,submitted,4,4,100,1');

    await call('POST', `/quizzes/${quizId}/release`);
    const mine = (await call('GET', `/portal/attempts/${amalAttempt}`, undefined, amal)).json();
    expect(mine.attempt).toMatchObject({ rank: 1, of: 3 });
  });

  it('copies a quiz as an independent draft', async () => {
    const quizId = await openQuiz();
    const res = await call('POST', `/quizzes/${quizId}/duplicate`);
    expect(res.statusCode).toBe(201);
    const copy = res.json().quiz;
    expect(copy).toMatchObject({ status: 'draft', title: 'Term test 1', totalPoints: 4 });
    const detail = (await call('GET', `/quizzes/${copy.id}`)).json();
    expect(detail.questions.map((q: { body: string }) => q.body)).toEqual([
      '2 + 2 = ?',
      'Which are prime?',
    ]);
    // Editing the copy leaves the original alone.
    await call('PUT', `/quizzes/${copy.id}/questions`, { questions: [QUESTIONS[0]] });
    expect((await call('GET', `/quizzes/${quizId}`)).json().questions).toHaveLength(2);
  });
});
