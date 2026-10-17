# Tuition LMS: online quizzes and exams

**Status:** Phases 1 to 3 built 2026-10-17 (MCQ, typed answers and marking, ranks and sharing), not released. Photo answers dropped. Decisions in [§16](#16-decisions). Written 2026-10-17 against commit `eb2abfc`.
**Goal:** Teachers create online quizzes and exams for a class. MCQ answers are marked automatically. Typed answers (short or essay) are marked by the teacher. Students see their marks when the teacher releases them.
**Related:** [RELEASE_V1.md](RELEASE_V1.md) lists "MCQ tests, exams + ranks" for v1.1. [ADR 002](adr/002-shared-db-rls.md) (RLS), [ADR 006](adr/006-whatsapp-first.md) (WhatsApp first), [SAAS_PLAN §7](SAAS_PLAN.md#7-entitlements-engine) (feature switches).

---

## Contents

1. [Summary](#1-summary)
2. [How online quiz systems work (research)](#2-how-online-quiz-systems-work-research)
3. [What exists today](#3-what-exists-today)
4. [Scope](#4-scope)
5. [How a quiz works, start to finish](#5-how-a-quiz-works-start-to-finish)
6. [Question types and marking rules](#6-question-types-and-marking-rules)
7. [Timing, saving and submitting](#7-timing-saving-and-submitting)
8. [Manual marking and releasing results](#8-manual-marking-and-releasing-results)
9. [Fairness and cheating](#9-fairness-and-cheating)
10. [Who can do what](#10-who-can-do-what)
11. [Data model (migration 017)](#11-data-model-migration-017)
12. [API](#12-api)
13. [Screens](#13-screens)
14. [Implementation phases](#14-implementation-phases)
15. [Risks](#15-risks)
16. [Decisions](#16-decisions)
17. [Sources](#17-sources)

---

## 1. Summary

| What | How |
|---|---|
| Teacher creates a quiz for one class | Title, instructions, open and close time, optional time limit, questions |
| Question types | **Auto-marked:** MCQ (one answer), MCQ (several answers). **Teacher-marked:** short typed answer, essay |
| Student takes it | Portal, phone first. One question per screen. Every answer saved as it is given. The server keeps the clock |
| Marking | MCQ marked the moment the student submits. Typed answers wait in a marking queue. The teacher marks them one question at a time across all students |
| Results | Hidden until the teacher clicks **Release results**. All-MCQ quizzes can release automatically |
| Parents | See released marks on their portal; the teacher can send them by WhatsApp link (same pattern as fee reminders) |
| Plan feature | New feature switch `quizzes`, set per price book like `live_links` |

Phase 1 ships MCQ end to end. A/L and O/L MCQ papers are the most common online test in Sri Lankan tuition, and the local apps that already sell (99Plus, Examiner, EDUS) lead with instant MCQ marking.

---

## 2. How online quiz systems work (research)

Studied: Moodle Quiz, Google Forms quizzes (used by Google Classroom), Canvas New Quizzes, university online exam guides and the local apps 99Plus, Examiner and EDUS.

### 2.1 Common patterns

| Pattern | Moodle | Google Forms | Canvas | Take for us |
|---|---|---|---|---|
| Objective questions marked automatically | Yes | Yes | Yes | Yes |
| Essays marked by hand | Yes; total not final until marked | Yes | Yes (SpeedGrader) | Yes |
| **Mark by question** (one question, all students) | "Review by question" | "Grade by question", hides names by default to reduce bias | "Grade by question" option | Yes, as the default marking screen, names hidden by default |
| Mark by student | "Review by student quiz" | Individual view | SpeedGrader default | Yes, second tab |
| Hold results until manual marking is done | Review options per phase | "Release grades: later, after manual review" | "Manual posting", because unmarked essays show as 0 | Yes: **results hidden until released** |
| Open and close times, time limit | Yes; auto-submit when time runs out; 60 s server grace | No time limit | Yes | Yes, with a server-side deadline and a small grace |
| Shuffle questions and options | Yes | Yes | Yes | Yes, per attempt |
| Teacher comment per answer | Yes | Yes | Yes | Yes |
| Several attempts, best / last / average | Yes | No | Yes | Later. One attempt in v1 |
| Question bank, random subset per student | Yes | No | Yes | Later |

### 2.2 Lessons from the research

- **The server must own the clock.** A browser timer can be paused, changed or reset. The server stores the deadline and refuses answers after it, with a short grace for slow networks. Moodle's default grace is 60 seconds.
- **Save every answer as it is given.** Guides say saving at each step "greatly reduces" lost work on poor connections. This matters on mobile data in Sri Lanka.
- **Unmarked essays should not show as 0.** Canvas and Google both learned this, so results stay hidden until manual marking is finished and released.
- **Grade by question is faster and fairer** than by student. Google hides names by default for this reason.
- **Short typed answers are unreliable to auto-mark.** A correct answer that is spelled or worded differently is marked wrong; Moodle users are told to check them by hand. Sinhala and Tamil typing makes this worse. In v1, short answers are teacher-marked.
- **No single anti-cheating control works.** Shuffling stops "answer 7 is B" sharing. Server time stops clock tricks. Higher-order questions resist searching. Browser lock-down and copy-blocking are only deterrents. We do the cheap server-side layers and leave proctoring out.
- **Multiple-answer MCQ scoring varies.** Choices are all-or-nothing, partial credit, or right-minus-wrong with a floor of 0. Research finds partial credit fairer, but no formula clearly best. We offer all-or-nothing (default) and partial credit with a floor of 0.
- **Handwritten work is normal here.** A photo answer type was planned for it, then dropped on 2026-10-17: there is no object storage, and files are not to be kept in Postgres.

---

## 3. What exists today

| Area | Today | Consequence |
|---|---|---|
| Classes | `batches` with one `teacher_membership_id`; `enrollments` with `status = 'active'` | A quiz belongs to one batch. Teachers manage quizzes for their own batches only, like `classes/routes.ts` already scopes them |
| Students online | Portal: `student` and `parent` memberships linked to students through `portal_access` | Students take quizzes through the portal; parents only see results ([§16](#16-decisions) Q1) |
| Isolation | Every tenant table has `tenant_id` with forced RLS; `enableTenantRls()` in each migration | All new tables use it; add them to `tenant-isolation.test.ts` |
| Feature switches | `FEATURES` in `billing/catalogue.ts`; routes declare `config: { feature }` | Add `quizzes` |
| Messaging | Click-to-WhatsApp links built by the app | Result messages use the same pattern |
| Jobs | No background job runner; invoices are generated by a click | Time-outs are finalised lazily on read ([§7.3](#73-time-out-without-a-job-runner)) |
| Migrations | 015 is the latest on `main`; 016 is held on a branch | This feature is **017** |

---

## 4. Scope

**In (phases 1 to 4):**
- quizzes for one class;
- five question types;
- open and close time, and an optional time limit;
- shuffling;
- one attempt;
- auto-marking;
- manual marking by question and by student, with comments;
- release results;
- class rank and average;
- parent view;
- WhatsApp result link;
- CSV export;
- duplicate a quiz to reuse it.

**Out for now** (each fits later without schema rework):
- several attempts;
- question bank with random subsets;
- negative marking for single MCQ;
- photo answers, question images and images in options (need object storage);
- maths formatting (KaTeX);
- proctoring (tab-switch logs, camera);
- one quiz for several classes;
- AI-suggested marks for essays;
- auto-marked short answers with accepted-answer lists.

---

## 5. How a quiz works, start to finish

```text
Teacher                         Student                          System
───────                         ───────                          ──────
Create quiz (draft)
Add questions, set answer key
Publish ──────────────────────▶ sees it in portal at opens_at
                                Start ─────────────────────────▶ attempt created, deadline fixed,
                                                                 question/option order shuffled
                                Answer (each one saved) ───────▶ stored; refused after deadline + grace
                                Submit (or time runs out) ─────▶ MCQ marked now; typed → queue
Mark queue (by question) ◀────────────────────────────────────── "12 answers to mark"
Release results ──────────────▶ sees marks, comments and,
                                if allowed, correct answers
Send WhatsApp to parents ─────▶ parent sees marks in portal
```

**Quiz states:** `draft` → `published` → `closed` (after `closes_at`) → `released`.
- **Draft:** everything can be edited.
- **Published:** questions are locked once any student has started. Fixing a wrong answer key is allowed and triggers a **re-mark** of auto-marked answers.
- **Released:** marks are visible. The teacher can **un-release** to fix something.

**Attempt states:** `in_progress` → `submitted` (or `timed_out`) → `marked`. `marked` means every answer has a score.

---

## 6. Question types and marking rules

| Type | Student gives | Marked by | Rule |
|---|---|---|---|
| `mcq` | One option | Auto | Full points if the chosen option is correct, else 0 |
| `multi` | One or more options | Auto | Per question: **all-or-nothing** (default), or **partial**: `max(0, (right picked − wrong picked) ÷ total right) × points` |
| `short` | A line of text (≤ 500 chars) | Teacher | 0 to points, in 0.5 steps |
| `essay` | Long text (≤ 20,000 chars) | Teacher | Same |

- **Points:** each question has points (default 1). The quiz total is their sum, and a percentage is shown alongside.
- **Options:** each MCQ has 2 to 6 options; A/L papers use 5.
- **Optional explanation** per question, shown to the student after release if the teacher allows it.
- **Unanswered:** 0, never an error.
- **Re-mark:** if the answer key changes, auto scores are recomputed from the stored choices, so nothing about the student's answer is lost.

---

## 7. Timing, saving and submitting

### 7.1 Deadline

- **When an attempt starts,** the server fixes `deadline = min(started_at + time_limit, closes_at)`, or `closes_at` when there is no limit.
- **The client** shows a countdown from the server's `deadline` and `now`. It never trusts its own clock for the end.
- **Answer saves** are accepted until `deadline + 30 s` grace. After that the API returns `409 time_up`.
- **Starting late** gives less time. A student who starts 10 minutes before `closes_at` gets 10 minutes, as in Moodle.

### 7.2 Saving

- **Every answer is saved as it is given.** That means each MCQ tap, and typing debounced to about 1.5 s. Each save is `PUT /attempts/:id/answers/:questionId`, and saving the same answer twice is harmless.
- **Unsent answers are kept in `localStorage`** and retried on reconnect, so a dropped signal does not lose work.
- **The screen shows** "Saved" or "Saving…" or "Offline, will retry".

### 7.3 Time-out without a job runner

When time runs out and the student never pressed Submit, the attempt is finalised lazily:
- any read of that attempt or of the quiz's results runs one `UPDATE … SET status = 'timed_out' WHERE status = 'in_progress' AND deadline + grace < now()`;
- MCQ answers are then marked.

No cron is needed, and results are correct whenever anyone looks.

### 7.4 One attempt

There is a unique partial index on `(quiz_id, student_id)`. Pressing Start twice returns the same attempt, so a refresh or a second device continues it.

---

## 8. Manual marking and releasing results

### 8.1 Marking screens

Teacher → quiz → **Results**, as tabs, matching the new UI:

| Tab | Shows |
|---|---|
| **Overview** | Submitted / in progress / not started counts, average, highest, lowest, how many answers still to mark, and a **Release results** button |
| **Mark by question** (default for marking) | Pick a teacher-marked question. Each student's answer is shown in turn, with a points box, quick buttons (0 / half / full) and a comment. Names are hidden until the teacher reveals them. Keyboard: Enter saves and goes to the next answer |
| **Mark by student** | One student's whole attempt, every question, editable marks, including overriding an auto mark |
| **Questions** | Per MCQ: % correct and how many picked each option, to find a wrong answer key or a hard question |

Every mark records `marked_by` and `marked_at`. Overriding an auto mark is allowed and shown as "changed by teacher".

### 8.2 Release

- **Release results** is allowed when every submitted attempt is `marked`. If some are not, the button shows "12 answers still to mark" and asks for confirmation to release only the fully marked attempts.
- **Release settings** per quiz:
  - Show marks: always on.
  - Show which answers were right or wrong, and the correct answer: on or off (default on).
  - Show explanations: on or off.
- **Auto-release:** only for quizzes with **only** MCQ questions. Choose "right after submit" or "after the quiz closes" (the default, so answers don't leak to students still sitting it).
- **Rank and average** are calculated at release over submitted attempts. Ties share a rank, e.g. 1, 2, 2, 4.
- **WhatsApp:**

  > Kasun scored 78/100 in Term Test 2. Class rank 12/140. – Nimal Sir

  This is the existing click-to-send pattern from [RELEASE_V1.md](RELEASE_V1.md#click-to-whatsapp-examples): one Send per parent.

---

## 9. Fairness and cheating

**Done (cheap, server-side):**
- **The answer key never reaches the student before release.** Student endpoints select only option ids and text, never `is_correct` or explanations. This gets a dedicated API test.
- **Server deadline and grace** ([§7.1](#71-deadline)).
- **Shuffling:** question and option order are shuffled per attempt. The order is stored on the attempt (`question_order`, and an option order per question) so a refresh shows the same order.
- **Eligibility is checked at start:**
  - an active enrollment in the quiz's class;
  - if the quiz is "Paid students only": no unpaid invoice for that month;
  - a `student` membership linked through `portal_access`;
  - the quiz is open.
- **One attempt** per student ([§7.4](#74-one-attempt)).
- **Late answers are not marked:** the server stores answers sent after the deadline, but they score 0.

**Not done:** browser lock-down, copy/paste blocking, camera proctoring and tab-switch tracking. They are deterrents at best, annoying on phones, and add privacy load. They can be added later as logging only.

**Advice for teachers:** shown in the builder: "Use your own questions, not past-paper ones students can search."

---

## 10. Who can do what

| Action | Owner / admin | Teacher | Receptionist | Student | Parent |
|---|---|---|---|---|---|
| Create, edit, publish quizzes | All classes | Own classes | – | – | – |
| Mark, release, export | All classes | Own classes | – | – | – |
| See results | All | Own classes | – | Own, after release | Linked children, after release |
| Take a quiz | – | – | – | Own (enrolled) | – ([§16](#16-decisions) Q1) |

All quiz routes also need the plan feature `quizzes` (`config: { feature: 'quizzes' }`). Without it, the sidebar item shows the lock, and pages show the `<Locked>` card. This is the same as Bank slips.

---

## 11. Data model (migration 017)

All tables have `tenant_id`, composite foreign keys `(tenant_id, id)` and `enableTenantRls()`, like `004_classes_schedule.ts`.

```text
quizzes
  id, tenant_id, batch_id → batches
  title (200), instructions (text, ≤ 5,000)
  status: draft | published | released          -- "closed" is derived from closes_at
  opens_at, closes_at (timestamptz), time_limit_minutes (null = none)
  shuffle_questions bool, shuffle_options bool
  show_correct bool, show_explanations bool
  require_paid bool default false                -- "Paid students only" (§16 Q2)
  auto_release: off | on_submit | on_close       -- only allowed when every question is mcq/multi
  total_points numeric(7,2)                      -- kept in sync when questions change
  created_by_membership_id, released_at, created_at, updated_at
  CHECK closes_at > opens_at

quiz_questions
  id, tenant_id, quiz_id → quizzes ON DELETE CASCADE
  position int, type: mcq | multi | short | essay
  body text (≤ 5,000), explanation text, points numeric(5,2) > 0
  multi_scoring: all_or_nothing | partial         -- multi only

quiz_options
  id, tenant_id, question_id → quiz_questions ON DELETE CASCADE
  position int, body text (≤ 1,000), is_correct bool
  -- trigger or service check: mcq has exactly 1 correct, multi ≥ 1

quiz_attempts
  id, tenant_id, quiz_id, student_id → students ON DELETE CASCADE
  membership_id                                   -- who sat it (the student login)
  status: in_progress | submitted | timed_out
  started_at, deadline, submitted_at
  question_order uuid[]                           -- shuffled order, fixed at start
  score numeric(7,2), marked bool                 -- score = sum of answer scores; marked = no answer awaiting a mark
  UNIQUE (tenant_id, quiz_id, student_id)

quiz_answers
  id, tenant_id, attempt_id → quiz_attempts ON DELETE CASCADE, question_id
  option_ids uuid[]                               -- mcq/multi
  option_order uuid[]                             -- shuffled order shown
  text text                                       -- short/essay
  score numeric(5,2) null                         -- null = not marked yet
  marked_by_membership_id null                    -- null + score = auto-marked
  comment text, saved_at, marked_at
  UNIQUE (attempt_id, question_id)
```

**Indexes:**
- `quizzes (tenant_id, batch_id, opens_at)`;
- `quiz_attempts (tenant_id, quiz_id, status)`;
- `quiz_answers (tenant_id, question_id) WHERE score IS NULL`, for the marking queue.

**Why `numeric`:** half marks and partial credit; no float rounding in totals.

---

## 12. API

All under `/api/v1/tenants/:tenantId`, with `config: { feature: 'quizzes' }`.

**Teacher and admin:**

| Method and path | Purpose |
|---|---|
| `GET /quizzes?batchId=` | List with counts (submitted, to mark) |
| `POST /quizzes` | Create draft |
| `GET/PATCH/DELETE /quizzes/:id` | Read, edit settings, delete draft |
| `POST /quizzes/:id/duplicate` | Copy as a new draft (reuse for another class or year) |
| `PUT /quizzes/:id/questions` | Replace the full question list (simplest for a builder); refused once attempts exist |
| `PUT /quizzes/:id/questions/:qid/key` | Fix the answer key at any time; re-marks every finished attempt |
| `POST /quizzes/:id/publish` / `unpublish` | Validate (≥ 1 question, every MCQ has a key, not closed) and publish; back to draft only before anyone starts |
| `GET /quizzes/:id/results` | Overview, attempts, stats; finalises timed-out attempts |
| `GET /quizzes/:id/marking` | What is left to mark, per question and per student |
| `GET /quizzes/:id/marking/:questionId` | Every finished answer to one question |
| `GET /quizzes/:id/attempts/:attemptId` | One student's whole attempt, with the key |
| `PATCH /quiz-answers/:answerId` | `{ score, comment }`; also overrides an auto mark, which a later key fix then keeps |
| `POST /quizzes/:id/release` / `unrelease` | Release results. With answers still to mark it returns `409 unmarked { count }`; `{ force: true }` releases, and unmarked attempts stay hidden until marked. Ranks come in phase 4 |
| `GET /quizzes/:id/results.csv` | Export |

**Student:**

| Method and path | Purpose |
|---|---|
| `GET /portal/quizzes` | Open, upcoming and released quizzes for the linked student |
| `POST /portal/quizzes/:id/start` | Create or return the attempt; returns questions **without the key**, server `now`, `deadline` |
| `PUT /portal/attempts/:id/answers/:questionId` | Save one answer (options, text or files); idempotent |
| `POST /portal/attempts/:id/submit` | Submit; marks MCQ |
| `GET /portal/attempts/:id` | The attempt: questions without the key while it runs; after release also marks, key and explanations if allowed. Parents only after release |


**Parent:** `GET /portal/quizzes` returns released results for linked children, without the take endpoints.

**As built (phase 1):** routes in `apps/api/src/modules/quizzes/routes.ts`; screens in `apps/web/src/components/quizzes/`; the student's attempt page is `/t/:tenantId/quizzes/attempt/:attemptId`. Ranks are computed on read (`rank()` over fully marked attempts), not stored, so they are always current; the student sees theirs once results are out.

**Marking code:** lives in `modules/quizzes/marking.ts` as pure functions (`markMcq`, `markMulti`, `attemptTotal`, `ranks`) with unit tests. The routes only load and save.

---

## 13. Screens

Built with the existing tokens, `Tabs`, `Badge` and `card`. All strings go in the three dictionaries.

**Staff**

1. **Sidebar: Quizzes** (owner, admin, teacher), and a **Quizzes** tab on the class page. The list shows status badge, dates, submitted / to mark, and New quiz.
2. **Quiz builder**, with tabs:
   - **Settings:** title, class, opens, closes, time limit, shuffle, release options.
   - **Questions:** a list of question cards with type picker, body, options with a "correct" toggle, and points. Reorder with up and down buttons; no drag library. Paste-friendly: one option per line.
   - **Preview:** exactly what a student sees.

   Publish runs the validation and lists any problems.
3. **Results**, with tabs: Overview · Mark by question · Mark by student · Questions ([§8.1](#81-marking-screens)). A red count on the tab shows answers still to mark.

**Student (portal, phone first)**

4. **Portal overview:** a "Quizzes" block with open now (Start / Continue, or "Pay this month's fee to start" when the quiz is paid-only), upcoming (opens …), and results.
5. **Take quiz:** full width with no sidebar.
   - **Top bar:** title, countdown, and "Saved".
   - **Body:** one question per screen, with big tap targets for options, or a text box for typed answers.
   - **Bottom:** Previous / Next and a question grid (answered, flagged, empty).
   - **Submit:** shows "3 unanswered", then asks for confirmation.
   - **Timer:** turns amber at 5 minutes and red at 1 minute. At 0 the page submits and shows "Time is up, your answers were saved".
6. **Result:** score, %, rank, then each question with the student's answer, right or wrong (if allowed), the teacher's comment and the explanation.

**Parent**

7. **Portal:** released results per child (score, rank, quiz name, date).

---

## 14. Implementation phases

Each phase is shippable and released on its own.

| Phase | Delivers | Tests |
|---|---|---|
| **1. MCQ end to end** | Migration 017 (all tables); `quizzes` feature; builder for `mcq` and `multi`; publish; student take (timer, autosave, submit, time-out); auto-mark; results overview; release with auto-release; student result page | Marking unit tests; key never in student responses; deadline + grace enforced; one attempt; teacher sees own classes only; tenant isolation for new tables |
| **2. Typed answers and marking** | `short` and `essay`; marking queue; mark by question and by student; comments; override auto marks; release with partial-marking warning | Manual marks sum; release blocked or confirmed when unmarked; parent sees only released |
| **3. Ranks and sharing** | Rank and average at release; WhatsApp result links to parents; CSV; duplicate quiz; per-question statistics | Rank ties; CSV escaping (reuse `lib/csv.ts`) |

**Rough size:** phase 1 is the largest, with about 1 migration, 1 API module, 3 staff screens and 3 portal screens. Phases 2 and 3 are smaller, reusing what phase 1 builds.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Poor mobile data loses answers | Per-answer save, `localStorage` queue, retry, grace period |
| Server and phone clocks differ | Countdown from server `now` and `deadline`; the server decides |
| Answer key leaks | Separate student query shapes; API test asserts no `isCorrect` before release |
| Teacher edits questions after students start | Locked; only answer-key fixes, which trigger re-mark |
| Students share answers during an open window | Shuffle; short windows with time limits; result release after close by default |
| Marking load for big classes | Mark by question with keyboard flow; quick 0 / half / full buttons |
| Sinhala and Tamil input on phones | Native inputs only; no custom keyboards |

---

## 16. Decisions

Decided 2026-10-17:

| # | Question | Decision |
|---|---|---|
| 1 | Who sits a quiz on a shared phone | **Student login only.** Parents see released results; they cannot sit a quiz |
| 2 | Block students with an unpaid fee | **Off by default, with a per-quiz switch** "Paid students only" (`quizzes.require_paid`). The check is the same as for live links: no issued or part-paid invoice for the quiz month |
| 3 | Auto-release for MCQ-only quizzes | **After the quiz closes** by default. Teachers can pick "right after submit" for practice quizzes, or off |
| 5 | First release | **MCQ first** ([§14](#14-implementation-phases) phase 1), then typed answers. Photo answers dropped (no object storage) |

Still open:
4. Plans: is `quizzes` included in the trial and all paid price books, or a paid add-on? Until decided, the migration turns it on in the default and trial price books, like `portal`.

## 17. Sources

- Moodle: [Quiz settings](https://docs.moodle.org/en/Quiz_settings); [Grade a quiz (Monash)](https://www.monash.edu/learning-teaching/TeachHQ/moodle/quiz/how-to/grade-a-quiz); [Automatic and manual grading (Carleton)](https://stolafcarleton.teamdynamix.com/TDClient/2092/Carleton/KB/ArticleDet?ID=141893)
- Google Forms: [Release grades and grade by question](https://support.google.com/a/users/answer/13344425)
- Canvas: [Using SpeedGrader for New Quizzes (ISU)](https://tigertracks.isu.edu/TDClient/1950/Portal/KB/Article/168247/Using-SpeedGrader-for-New-Quizzes-in-ISU-Canvas); [Essay questions in New Quizzes (Cedarville)](https://ctl.cedarville.edu/wp/best-practices-for-using-essay-questions-in-new-quizzes/)
- Exam integrity and timing: [Server-side exam timer](https://oneuptime.com/blog/post/2026-03-31-redis-online-exam-timer/markdown); [Best practices for online exams (UTK)](https://teaching.utk.edu/wp-content/uploads/sites/78/2020/04/Best-Practices-for-Online-Exams.pdf); [Reducing cheating (Palomar)](https://www.palomar.edu/teachanywhere/?p=434); [Quiz delivery (TMU)](https://www.torontomu.ca/courses/instructors/tutorials/quizzes/quiz-manage-questions/)
- Multiple-answer scoring: [Blackboard partial and negative credit](https://help.blackboard.com/node/45796); [Partial-credit methods study (PMC8725057)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8725057); [Balanced scoring for multiple-mark questions](https://scitepress.org/Papers/2013/43843/pdf/index.html)
- Sri Lankan apps: [99Plus](https://mwm.ai/apps/99plus/6670314903); [EDUS](https://edustutor.com/llms-full.txt); [mLearn Education](https://apps.apple.com/us/app/id1577115105)
