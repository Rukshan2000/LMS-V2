# Task List

Based on [BUILD_GUIDE.md](BUILD_GUIDE.md). Mark `[x]` when done.

**Legend:** `[x]` completed · `[ ]` not completed · `[~]` in progress

**Progress:** Step 0: 14/25 · Steps 1–6: 2/63

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
- [ ] Confirm hosting can run Node.js + Docker + PostgreSQL 16
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
- [x] Install Node.js 22 LTS + npm, Docker, Git
- [ ] Create monorepo (`apps/web`, `apps/api`, `packages/db`) + npm `workspaces` in root `package.json`
- [ ] `docker-compose.yml` with Postgres 16 (Redis in v2)
- [ ] TypeScript strict, ESLint, Prettier
- [ ] `.env.example`, `.gitignore`, Zod env validation
- [x] Push docs to GitHub
- [ ] Protect `main` branch on GitHub

## Step 2: Database foundation
- [ ] Create `owner` and `app_user` roles with grants
- [ ] Knex setup in `packages/db`
- [ ] Migration `001_extensions_and_users` (pgcrypto, users, auth_sessions)
- [ ] Migration `002_tenants_memberships_roles` with RLS forced
- [ ] `withTenant()` helper
- [ ] Vitest against real Postgres
- [ ] Test: tenant A cannot see tenant B
- [ ] Test: no tenant context returns nothing
- [ ] Migrations run up and down cleanly

## Step 3: Backend skeleton
- [ ] Fastify app structure (`plugins/`, `modules/`)
- [ ] Plugins: db, auth, tenant, errors
- [ ] `GET /health`
- [ ] Signup, login, logout (Argon2id + session cookie)
- [ ] `POST /tenants` (tenant + owner membership in one transaction)
- [ ] Tenant plugin: membership check + `withTenant`
- [ ] `requireRole()` helper
- [ ] API tests: 401 no cookie, 404 other tenant, 403 wrong role
- [ ] GitHub Actions CI: typecheck, lint, test, build
- [ ] Deploy staging + run migrations in CI
- [ ] Daily DB backup on staging

## Step 4: Frontend skeleton
- [ ] Next.js app (TS + Tailwind + App Router)
- [ ] i18n with `si`, `ta`, `en`
- [ ] Login / signup pages
- [ ] Create institute page
- [ ] Dashboard shell with role-based sidebar
- [ ] Tenant switcher
- [ ] Full flow works on staging (phone + desktop)

## Step 5: Feature slices
Each slice is complete only when it has: migration + RLS → repo → service → route → tests → UI → deployed to staging.

#### v1.0 (no business registration needed)
- [ ] 1. Students & guardians + CSV import
- [ ] 2. Subjects, batches, enrollments, timetable/sessions
- [ ] 3. QR class cards (PDF) + scan attendance + click-to-WhatsApp attendance message
- [ ] **Pilot 1: first friendly teacher starts using it**
- [ ] 4. Fees, concessions, invoices, cash payment, receipt PDF, not-paid list, reminder links
- [ ] 5. Bank slip upload + verify + duplicate flag + access unlock
- [ ] 6. Live class links per session (paid students only)
- [ ] 7. Student/parent portal + web push
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
- [ ] 15. Tamil UI

#### v2.0 (needs business accounts)
- [ ] 16. PayHere checkout + webhook auto-unlock
- [ ] 17. Worker + outbox + WhatsApp Cloud API + SMS fallback

## Step 6: Hardening and pilot
- [ ] Load test: scan burst + month-start billing (k6)
- [ ] Restore drill + `docs/runbooks/restore.md`
- [ ] Structured logs (Sentry in v1.1, uptime check in v2)
- [ ] Sinhala/Tamil translation review by native speaker
- [ ] Privacy notice, parent consent, data deletion process
- [ ] Lawyer review of PDPA obligations
- [ ] Pilot with 2–5 institutes (1 online A/L teacher)
- [ ] Track support messages and failed tasks weekly
- [ ] Production checklist ([implementationplan.md §12](implementationplan.md)) passes
