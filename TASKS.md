# Task List

Based on [BUILD_GUIDE.md](BUILD_GUIDE.md). Mark `[x]` when done.

**Legend:** `[x]` completed · `[ ]` not completed · `[~]` in progress

**Progress:** Step 0: 15/25 · Steps 1–6: 70/97

**Live:** https://lms.kwingsmedia.com · **Release:** `git checkout production && git merge --ff-only main && git push`

**Next up:** Step 5 slice 6 (Live class links per session, paid students only). Pilot 1 can start now.

---

## Step 0: Decide and prepare

### Planning
- [x] Write implementation plan ([implementationplan.md](implementationplan.md))
- [x] Write build guide ([BUILD_GUIDE.md](BUILD_GUIDE.md))
- [x] Desk research: market, competitors, pricing, providers, law ([docs/STEP0_RESEARCH.md](docs/STEP0_RESEARCH.md))
- [x] Write ADRs 001–008 ([docs/adr/](docs/adr/))

### 0.1 Talk to users (done via public-source research, no real users available)
- [x] Answer the 10 interview questions from public evidence ([docs/STEP0_USER_RESEARCH.md](docs/STEP0_USER_RESEARCH.md))
- [x] Build personas: online A/L teacher, small institute, home tutor, parent
- [x] Document real workflows: desk entry, cash and slip payment, WhatsApp access, teacher payout
- [x] Document fee structure: class / AC / tute fees, free and half cards, sibling discount, 1st/5th billing
- [x] Update research positioning and the plan's MVP table from findings
- [x] Change ADR 006 (WhatsApp) and 008 (pricing) → Accepted (provisional)
- [ ] Validate with 3 real users during pilot (5 questions in research doc §4)
- [ ] Collect real samples: fee receipt, class card, payout sheet, marks sheet

### 0.2 Accounts
Needed for v1.0 ([docs/RELEASE_V1.md](docs/RELEASE_V1.md)):
- [x] GitHub repo ([Rukshan2000/LMS-V2](https://github.com/Rukshan2000/LMS-V2))
- [x] Domain (subdomain on existing domain)
- [x] Hosting
- [x] Confirm hosting is a VPS with SSH + sudo (Ubuntu 24.04, 6 CPU, 11 GB RAM, shared with other apps)
- [x] Gmail account with 2-Step Verification + App Password (email via SMTP)

Needed for v1.1:
- [ ] Sentry
- [ ] Bunny.net Stream

Needed for v2.0 (start in parallel, slow approvals):
- [ ] Uptime check (UptimeRobot free)
- [ ] Business registration
- [ ] Business bank account
- [ ] PayHere sandbox → live merchant
- [ ] Meta Business + WhatsApp Cloud API
- [ ] Local SMS gateway + sender mask

---

## Step 1: Repository and tooling
- [x] Install Node.js 22 LTS + npm, Git, PostgreSQL 16 (Homebrew). No Docker locally
- [x] Create monorepo (`apps/web` Next.js 16, `apps/api`, `packages/db`) + npm `workspaces` in root `package.json`
- [x] Local databases `LMS_V2` + `LMS_V2_test` (Homebrew Postgres 16, port 5432)
- [x] TypeScript strict, ESLint, Prettier
- [x] `.env.example`, `.gitignore`, Zod env validation (`apps/api/src/env.ts`)
- [x] Push docs to GitHub

## Step 2: Database foundation
Local DB: Homebrew Postgres 16 on 5432, databases `LMS_V2` (dev) and `LMS_V2_test` (tests). See [BUILD_GUIDE.md Step 2](BUILD_GUIDE.md).
- [x] Restricted app role `lms_app` (NOSUPERUSER, NOBYPASSRLS) + default grants (`packages/db/scripts/init-database.sql`)
- [x] Knex setup in `packages/db` (`createKnex`, migrate CLI: `npm run migrate -- latest|rollback|status|check`)
- [x] Migration `001_extensions_and_users` (users, auth_sessions)
- [x] Migration `002_tenants_memberships_roles` with RLS forced (branches, tenant_memberships, membership_roles)
- [x] `withTenant()` / `withUser()` helpers (`packages/db/src/context.ts`)
- [x] Vitest against real Postgres (`npm test`)
- [x] Test: tenant A cannot see tenant B (+ insert/update/delete blocked)
- [x] Test: no tenant context returns nothing
- [x] Test: context does not leak across pooled connections
- [x] Test: every `tenant_id` table has forced RLS; app role cannot edit migration history
- [x] Migrations run up and down cleanly (`npm run migrate -- check`)

## Step 3: Backend skeleton
API: `apps/api/src` — `plugins/` (db, auth, tenant, errors), `modules/` (identity, tenancy). Bundled with esbuild.
- [x] Fastify app structure (`plugins/`, `modules/`, `lib/`)
- [x] Plugins: db, auth (session cookie), tenant (membership check), errors (`{code, message, requestId}`)
- [x] `GET /api/health` (checks DB)
- [x] Signup, login, logout, me (`/api/v1/auth/*`): Argon2id, hashed session tokens, HttpOnly cookie, SL phone normalisation
- [x] Login/signup rate limit (10/min per IP)
- [x] `POST /api/v1/tenants` (tenant + owner membership + Main branch in one transaction)
- [x] Tenant plugin: `/tenants/:tenantId/*` requires active membership, `req.withTenant()`
- [x] `requireRole()` helper (`GET /tenants/:tenantId/branches` = owner/admin)
- [x] API tests (13): 401 no cookie, 404 other/random/malformed tenant, 403 wrong role, logout revokes, rate limit, hashes only
- [x] Mutation-checked: removing the role or membership check makes tests fail

## Step 3b: Deployment and CI/CD (Docker on server only)
Flow: push to `production` → Actions checks → build images → GHCR → SSH (forced command) → deploy.sh → smoke check.
Details: [docs/runbooks/deploy.md](docs/runbooks/deploy.md). Live at https://lms.kwingsmedia.com (shared server `164.68.97.187`).

### Server setup (once)
- [x] Docker Engine + Compose plugin on server (already installed: Docker 29.4, Compose 5.1)
- [x] Create `deploy` user (password locked, SSH key only, `docker` group, key forced to `deploy.sh`)
- [x] Firewall: ufw active, Postgres blocked on public interface; app ports bound to 127.0.0.1 only
- [x] DNS: `lms.kwingsmedia.com` → server (wildcard `*.kwingsmedia.com`)
- [x] Reverse proxy with HTTPS: existing host nginx + certbot webroot; `/api/` → api :4006, rest → web :3013
- [x] PostgreSQL 16 (existing host server): `tuition_lms` DB, `tuition_lms_owner` + `tuition_lms_app` roles, random passwords
- [x] Server `app.env` for production (never in git, `root:deploy 640`)

### Docker images
- [x] `apps/api/Dockerfile` (multi-stage, Node 22 alpine, non-root `node` user)
- [x] `apps/web/Dockerfile` (Next.js `output: 'standalone'`, non-root `node` user)
- [x] `.dockerignore`
- [x] `deploy/docker-compose.yml` for server: api + web (host nginx + host Postgres, so no proxy/db containers)
- [x] Healthchecks: api `GET /api/health`, web `/` (both images test-built and run on server)

### CI (GitHub Actions: `.github/workflows/ci-cd.yml`)
- [x] Checks on pull request + push to `main`/`production`: `npm ci`, format, lint, typecheck, build
- [x] Run tests against a Postgres 16 service container in CI
- [x] Migration check in CI: up → down → up on an empty DB
- [ ] Protect `main` and `production`: require CI to pass before merge

### CD (GitHub Actions)
- [x] GitHub secret `DEPLOY_SSH_KEY`
- [x] Build + push images to GHCR tagged with git SHA
- [x] Deploy **production** automatically on push to the `production` branch only
- [x] Deploy step on server: `docker compose pull` → `docker compose up -d` (deploy.sh)
- [x] Migrations in deploy.sh as `tuition_lms_owner` (new image, before restart; owner creds only in `migrate.env`)
- [x] Post-deploy smoke check: `https://lms.kwingsmedia.com/api/health` and `/` must return 200, else fail
- [x] Rollback: previous SHA via `.env` + `docker compose up -d` (documented in runbook)
- [x] Fix: compose network pinned to `172.16.10.0/24` (Docker pool on server exhausted; other ranges cannot reach host Postgres)
- [x] Step 3 release live: migrations 001–002 applied on production DB
- [x] First successful pipeline deploy (2026-10-16, commit c7c845c)

### Backups and logs
- [x] Daily `pg_dump` at 02:30 (`/etc/cron.d/tuition-lms-backup`), keep 14 days
- [ ] Copy backups off-server
- [x] Restore tested into a temporary database
- [x] Docker log rotation (10 MB × 5 files per container)

## Step 4: Frontend skeleton
Web: `apps/web/src` — routes under `app/[lang]` (`si` default, `ta`, `en`), data loaded in the browser from same-origin `/api`.
- [x] Next.js app (TS + Tailwind + App Router) — Next.js 16 in `apps/web`
- [x] i18n with `si`, `ta`, `en`: locale routes, `proxy.ts` redirect (cookie → browser language → Sinhala), language switcher, Noto Sans fonts
- [x] Login / signup pages (API error messages translated)
- [x] Create institute page (link name auto-filled from the name)
- [x] Dashboard shell with role-based sidebar (`lib/nav.ts`, unbuilt items shown as "Soon")
- [x] Tenant switcher (+ "New institute"), last institute remembered
- [x] Tests: role menu + locale choice (9)
- [x] Full flow checked in a real browser, desktop + phone width: signup → create institute → dashboard → language switch → mobile menu → logout → wrong-login error (Tamil)
- [x] Step 4 released to production (pipeline deploy, smoke check incl. `/si/login`)
- [ ] **You:** sign up on https://lms.kwingsmedia.com on your phone + laptop and create an institute (Claude does not create accounts on production)

## Step 5: Feature slices
Each slice is complete only when it has: migration + RLS → repo → service → route → tests → UI → released via `production` branch.
No staging server yet: test locally, then release. Add staging when pilot users depend on production.

#### v1.0 (no business registration needed)
- [x] 1. Students & guardians + CSV import
  - Migration 003: `students`, `guardians` (shared by siblings via phone), `student_guardians`, `tenant_counters`; all RLS
  - API: list (search name / number / parent phone, cursor paging, active/inactive), create (duplicate warning + "add anyway"), view, edit (guardians, status), CSV import (preview → all-or-nothing commit, duplicates skipped)
  - UI: list, add, detail/edit, import (template download, per-line report) in si/ta/en
  - Tests: 17 new API tests (incl. tenant isolation, roles, import) + CSV parser; checked in browser (desktop + phone)
  - Released to production (migration 003 applied by pipeline)
- [x] 2. Subjects, batches, enrollments, timetable/sessions
  - Migration 004: `subjects`, `batches` (classes), `enrollments` (one active per class, history kept), `schedule_rules` (weekly, Sri Lanka time), `class_sessions`; all RLS
  - Sessions generated idempotently from weekly rules; one class can be cancelled/restored/moved without touching the rule; ending a slot keeps past sessions
  - Roles: owner/admin manage classes; receptionist enrolls; teacher sees only own classes, sessions and students, can cancel/move own classes
  - UI: classes list, new class, class detail (schedule, students, next classes), week timetable, "add to class" on student page; day/month names from our dictionaries (browser Sinhala/Tamil date support is unreliable)
  - Tests: 13 API (incl. teacher scoping, mutation-checked) + 5 web; checked in browser (create → schedule → enroll → cancel → restore → move)
  - [x] Staff invitations: owner/admin invite admin/teacher/receptionist by mobile → WhatsApp link (hashed token, 14 days, single use, only the invited mobile can accept); join page signs up/logs in in place; remove staff (not owner/self); 8 API tests; checked in browser
- [x] 3. QR class cards (PDF) + scan attendance + click-to-WhatsApp attendance message
  - Migration 006: `student_cards` (random token, one active per student, replace = revoke), `attendance_records` (one per student per class), `attendance_changes` (audit); all RLS
  - Scan by QR token or typed student number: finds the class running now (opens 60 min before start), late after 15 min, repeat scan = "already marked"; USB scanners and Android/desktop Chrome camera (BarcodeDetector); **iPhone Safari camera not supported yet**
  - After scan: WhatsApp-to-parent button with ready message (present/late); recent scans list
  - Attendance: day list → class register (present/late/absent, manual marks, changes audited); teachers only own classes; only desk staff scan
  - Cards: printable A4 sheet (bank-card size, QR + name + number), print one card, replace lost card
  - Tests: 10 API (incl. 20 simultaneous scans → 1 record); checked in browser (cards, scan, duplicate, register)
- [ ] **Pilot 1: first friendly teacher starts using it**
- [x] 4. Fees, concessions, invoices, cash payment, receipt PDF, not-paid list, reminder links
  - Migration 007: `batch_fees` (class/AC/tute), `student_concessions` (free card, half card, %), `invoices` (one per student per month, DB check `paid <= total`), `invoice_lines`, `payments` (client_ref = no double submit), `payment_allocations`; all RLS
  - Money never uses floating point: numeric(12,2) in DB, integer cents in JS, amounts in JSON cast to text
  - Monthly billing safe to re-run (mid-month class joins add only new lines); concessions on class fee only
  - Payments: oldest invoice first, student row + invoice rows locked, `paid` incremented in SQL; overpayment refused; one-off admission/other invoices; void only if unpaid
  - UI: fees month (summary, create invoices, not-paid list + WhatsApp reminder), class fee editor, student fees (concessions, invoices, take payment), printable receipt + WhatsApp receipt, "fees due" warning on scan
  - Tests: 12 API (incl. 5 simultaneous payments → 1, mutation-checked) + money helpers; checked in browser (fees → invoices → partial payment → receipt)
  - Found + fixed in browser test: invoice line amounts arrived as JSON numbers (floats)
- [x] 5. Bank slip upload + verify + duplicate flag (access unlock = slice 6, uses paid invoices)
  - Migration 009: `payment_slips` (file in Postgres, sha256, RLS); payments get `submitted_by_user_id`, `reviewed_at`, `review_note`; receipt number only on verify (no gaps from rejected slips)
  - Portal: "Paid at the bank? Send the slip" (photo shrunk in browser to ≤1600px JPEG, or PDF ≤3 MB; file type checked by content, not name); pending/rejected slips with reason shown to parent
  - Desk: Bank slips page (waiting / verified / rejected), photo, outstanding, flags for same photo or same bank reference seen before; verify (amount can be corrected) → allocated like cash + receipt; reject with reason
  - Tests: 8 API (incl. 3 simultaneous verifies → 1, wrong file type, parent limited to own children; mutation-checked); checked in browser (upload → verify → receipt)
  - Fixed: migration `down` failed when portal/slip rows existed (broke CI db tests for slice 7)
- [ ] 6. Live class links per session (paid students only)
- [x] 7. Student/parent portal (web push → later)
  - Migration 008: portal invites on `tenant_invites` (`student_id`, roles student/parent), `portal_access` (which students each parent/student account sees); RLS
  - Student page: "Parent / student app" → WhatsApp link per mobile (student's own or a guardian's only; only that mobile can accept; 14 days, single use)
  - Portal home: per child — outstanding fees + unpaid months, recent payments, next classes (2 weeks, cancelled shown), recent attendance; si/ta/en
  - Parents/students get only the overview (staff pages 403); not listed as staff; a parent can still be invited as staff
  - Tests: 6 API (access limited to invited children, mutation-checked) + money helper; checked in browser (invite → WhatsApp link → sign up on join page → portal, si)
  - [ ] Web push notifications (needs VAPID keys + service worker; add when parents ask for reminders beyond WhatsApp)
  - [ ] Staff can remove a parent's portal access (today: mark student inactive stops new invites only)
- [ ] 8. Reports + CSV export
- [ ] 9. Plans: free cap 50, manual plan activation
- [ ] **Beta: 3–5 teachers**
- [ ] **v1.0 release checklist passes ([docs/RELEASE_V1.md §7](docs/RELEASE_V1.md))**

#### v1.1
- [ ] 10. Recorded lessons (Bunny, watermark, device limit)
- [ ] 11. Offline scan queue + sync
- [ ] 12. Exams: MCQ, paper marks, ranks
- [ ] 13. Tutes handout
- [ ] 14. Teacher payout rules + statements
- [~] 15. Tamil UI (current screens translated; new screens + review pending)

#### v2.0 (needs business accounts)
- [ ] 16. PayHere checkout + webhook auto-unlock
- [ ] 17. Worker + outbox + WhatsApp Cloud API + SMS fallback

## Step 6: Hardening and pilot
- [ ] Load test: scan burst + month-start billing (k6)
- [ ] Restore drill with real pilot data (procedure in [docs/runbooks/deploy.md](docs/runbooks/deploy.md), empty-DB restore already tested)
- [x] Structured JSON logs (Fastify/pino) + Docker log rotation. Sentry in v1.1, uptime check in v2
- [ ] Sinhala/Tamil translation review by native speaker (all UI text in `apps/web/src/i18n/dictionaries/` was drafted by Claude)
- [ ] Privacy notice, parent consent, data deletion process
- [ ] Lawyer review of PDPA obligations
- [ ] Pilot with 2–5 institutes (1 online A/L teacher)
- [ ] Track support messages and failed tasks weekly
- [ ] Production checklist ([implementationplan.md §12](implementationplan.md)) passes
