# Build Guide: From Zero to Pilot

Companion to [implementationplan.md](implementationplan.md). The plan says **what** to build. This guide says **in what order** and **how**.

---

## The one rule: build in vertical slices

Do **not** build the whole database first, then the whole backend, then the whole frontend. You will spend months with nothing usable, and the schema will be wrong by the time the UI shows you the real needs.

Build **one feature at a time, top to bottom**:

```text
For each feature:
  1. Migration (DB table + RLS + constraints)
  2. Repository (Knex queries)
  3. Service (business rules, transactions)
  4. API route (validation + auth)
  5. Test (at least the money/security/duplicate cases)
  6. UI page
  7. Deploy to staging, click through it yourself
```

The **foundation** (repo, DB connection, auth, tenant isolation) is the only part built "horizontally" before features, because every feature depends on it.

---

## Step 0: Decide and prepare (Week 1, no code yet)

> **Desk research done:** see [docs/STEP0_RESEARCH.md](docs/STEP0_RESEARCH.md) and [docs/adr/](docs/adr/). Interviews (0.1) are still open.

### 0.1 Talk to users
- Visit 5–10 teachers/institutes. Include one online A/L teacher.
- Watch a receptionist work for 1 hour on a class day. Write down every step.
- Collect: a real fee receipt, a class card, a payout sheet, a marks sheet.
- Ask: "Which 3 things would you pay for first?"

### 0.2 Start slow approvals now
| Account | Why now |
|---|---|
| PayHere merchant (sandbox first) | Business verification takes time |
| Meta WhatsApp Business (Cloud API) | Business verification + template approval |
| Video provider (Bunny Stream / Cloudflare Stream) | Need it by Sprint 5 |
| Domain name + Cloudflare | DNS, TLS, CDN |
| Hosting (VPS or PaaS, Singapore/Mumbai region for low latency to SL) | Staging from week 2 |

### 0.3 Write down decisions (`docs/adr/`)
One short file per decision. Example `docs/adr/001-modular-monolith.md`:
```md
# 001 Modular monolith
Decision: one API app, modules by feature. No microservices.
Why: one developer/small team, simpler deploy, shared transactions.
Revisit when: a module needs separate scaling.
```
Write ADRs for: monolith, shared DB + RLS, session cookies, Knex, PayHere.

**Done when:** you have interview notes, accounts requested, 5 ADRs.

---

## Step 1: Repository and tooling (Week 1–2)

### 1.1 Install
- Node.js 22 LTS (includes npm), PostgreSQL 16 (Homebrew), Git, VS Code.
- **No Docker locally.** Docker is used only on the server to run the app.

### 1.2 Create the monorepo
```bash
mkdir tuition-lms && cd tuition-lms
git init
npm init -y
mkdir -p apps/web apps/api packages/db docs/adr
```

Root `package.json` (npm workspaces):
```json
{
  "name": "tuition-lms",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```
Run `npm install` once at the root. It installs every workspace and links `packages/db` so `apps/api` can import it.

Start with only **3 packages**: `apps/api`, `apps/web`, `packages/db`. Add `apps/worker`, `packages/contracts` etc. only when you need them.

### 1.3 Local database (Homebrew PostgreSQL 16, port 5432)
```bash
brew install postgresql@16
brew services start postgresql@16
psql -d postgres -c 'CREATE DATABASE "LMS_V2" OWNER postgres'
psql -d postgres -c 'CREATE DATABASE "LMS_V2_test" OWNER postgres'
```
`LMS_V2` is for development, `LMS_V2_test` is wiped on every test run. Do **not** use the `lms` database: another project uses it.

### 1.4 Code quality from day one
- TypeScript `strict: true` everywhere.
- ESLint + Prettier.
- `.env.example` committed, `.env` in `.gitignore`.
- Validate env at startup with Zod (app crashes if `DATABASE_URL` missing).

### 1.5 Git workflow
- `main` = always deployable.
- One branch per feature: `feat/attendance-scan`.
- Small commits. Open a PR to yourself and read the diff before merging.

**Done when:** local Postgres has `LMS_V2`, `npm run typecheck`, `npm run lint` and `npm run build` pass, repo pushed to GitHub.

---

## Step 2: Database foundation (Week 2)

This is the most important step. Mistakes here are expensive later.

### 2.1 Two database roles
Migrations run as the owner (`postgres` locally, `tuition_lms_owner` on the server). The app runs as a restricted role (`lms_app` locally, `tuition_lms_app` on the server) so RLS applies. **Superusers skip RLS**, so the app must never connect as `postgres`.
```bash
psql -d postgres -c "CREATE ROLE lms_app LOGIN PASSWORD 'lms_app' NOSUPERUSER NOBYPASSRLS"
for db in LMS_V2 LMS_V2_test; do
  psql -d "$db" -v owner=postgres -v app=lms_app -f packages/db/scripts/init-database.sql
done
```
`.env` (see `.env.example`):
```bash
DATABASE_URL=postgres://lms_app:lms_app@127.0.0.1:5432/LMS_V2
MIGRATION_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/LMS_V2
TEST_DATABASE_URL=postgres://lms_app:lms_app@127.0.0.1:5432/LMS_V2_test
TEST_MIGRATION_DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/LMS_V2_test
```

### 2.2 `packages/db` layout
```text
packages/db/
  src/knex.ts          createKnex(url)
  src/context.ts       withTenant() / withUser(): set app.tenant_id / app.user_id per transaction
  src/rls.ts           enableTenantRls(knex, table): call for every tenant-owned table
  src/migrations.ts    migrateLatest(): apply + lock migration history to the owner
  src/migrate.ts       CLI: npm run migrate -- latest | rollback | status | check
  migrations/          001_extensions_and_users.ts, 002_tenants_memberships_roles.ts
  test/                Vitest against the real LMS_V2_test database
  scripts/init-database.sql
```
No knexfile and no Knex CLI: `src/migrate.ts` runs migrations so TypeScript works without extra loaders. Inside `migrations/`, import other files with the `.ts` extension (Node loads them directly).

### 2.3 Migrations
- `001`: `users` (login by phone), `auth_sessions` (hashed tokens). Global tables, no RLS. `gen_random_uuid()` is built into PG 13+, so no extension is needed.
- `002`: `app_current_tenant()` / `app_current_user()` SQL functions, `tenants` (global registry), and `branches`, `tenant_memberships`, `membership_roles` with RLS enabled and forced.
- `tenant_memberships` has a second read policy: a user can see their own memberships in every tenant (needed before a tenant is chosen).
- New tenant-owned table? Add `tenant_id`, then call `enableTenantRls(knex, '<table>')` in the same migration. A test fails if you forget.

### 2.4 Tenant helpers
```ts
await withTenant(db, { tenantId, userId }, (trx) => trx('branches'));
await withUser(db, userId, (trx) => trx('tenant_memberships')); // my institutes
```
`tenantId` must come from a verified membership. Use only `trx` inside the callback.

### 2.5 Tests (`npm test`)
`packages/db/test/tenant-isolation.test.ts` proves:
- tenant A cannot see tenant B rows
- no context returns nothing (fails closed)
- context does not leak to the next query on the same pooled connection
- cannot insert, update or delete another tenant's rows
- a user sees only their own memberships across tenants
- the app role cannot change migration history
- every table with `tenant_id` has forced RLS

Checked: the same tests fail when the app connects as a superuser, so they really guard RLS.

**Done when:** `npm run migrate -- check` (up → down → up) and `npm test` pass locally and in CI.

---

## Step 3: Backend skeleton (Week 2–3)

### 3.1 Fastify app (`apps/api`)
```text
apps/api/src/
  server.ts            # build app, register plugins, start
  plugins/
    db.ts              # knex instance (restricted app role)
    auth.ts            # read session cookie → request.user
    tenant.ts          # :tenantId → check membership → request.tenantId
    errors.ts          # one error shape {code, message, requestId}
  modules/
    identity/          # routes.ts, service.ts, repo.ts, schema.ts, *.test.ts
    tenancy/
```
Each module has the same 4 files. Routes are thin: validate → call service → return.

### 3.2 Build in this order
1. `GET /health` returns DB ok. Deploy it (step 3.4).
2. Signup + login + logout (Argon2id hash, session row, HttpOnly cookie).
3. `POST /tenants` creates a tenant + owner membership in one transaction.
4. `tenant` plugin: every `/tenants/:tenantId/*` route checks membership and runs inside `withTenant`.
5. Role check helper: `requireRole('owner','admin')`.

### 3.3 API tests
Use Fastify's `app.inject()`. Test the sad paths first:
- No cookie → 401.
- Member of A calls B's URL → 404.
- Receptionist calls owner-only route → 403.

### 3.4 Deploy staging NOW
Even with only `/health` and login. Use Docker + a VPS (or Railway/Render/Fly).
- GitHub Actions: on push to `main` → typecheck, lint, test, build, run migrations, deploy.
- Daily DB backup from day one.

Deploying early means you fix deployment problems while the app is small.

**Done when:** you can sign up, create an institute, and log in on the staging URL.

---

## Step 4: Frontend skeleton (Week 3)

### 4.1 Next.js (`apps/web`)
```bash
npx create-next-app@latest apps/web --ts --tailwind --app --use-npm
```
- Calls the API with `fetch(..., { credentials: 'include' })`.
- **No business logic in Next.js.** It only shows data and sends forms.
- Add `next-intl` (or similar) now with `si`, `ta`, `en` folders. Adding i18n later means touching every page.

### 4.2 First pages
1. Login / signup.
2. Create institute.
3. Dashboard shell with role-based sidebar.
4. Tenant switcher (a user can belong to many institutes).

**Done when:** the full signup → create institute → dashboard flow works on staging, on a phone and on a desktop.

---

## Step 5: Feature slices (Week 4 onward)

Build each slice fully (DB → API → test → UI → staging) before starting the next.

| # | Slice | Key tests | Usable by a real class? |
|---|---|---|---|
| 1 | Students & guardians (+ CSV import) | Duplicate detection, isolation | Partly |
| 2 | Subjects, batches, enrollments, recurring sessions | Cancel one session keeps others | Partly |
| 3 | **Class cards + QR scan attendance** | 100 concurrent scans, no duplicates | **Yes: start pilot here** |
| 4 | Offline scan queue + sync | Replay same batch twice = no duplicates | Yes |
| 5 | Fee plans, concessions, monthly invoices, cash payment, receipt PDF | Rerun billing = no duplicate invoices; balances reconcile | Yes |
| 6 | Bank slip upload + verify | Same slip twice flagged | Yes |
| 7 | PayHere checkout + webhook | Webhook replay safe; bad signature rejected | Yes |
| 8 | Teacher payout rules + statement | Statement total = verified collections × rule | Yes |
| 9 | Tutes handout | One per student per item | Yes |
| 10 | Worker + outbox + WhatsApp/SMS | Retry does not resend twice | Yes |
| 11 | Recorded lessons (video provider) | Unpaid = no play; device limit | Yes |
| 12 | Exams: MCQ, paper marks, ranks | Rank ties correct | Yes |
| 13 | Student/parent portal | Parent sees only linked child | Yes |
| 14 | Reports + CSV export | Respects tenant/date filters | Yes |
| 15 | SaaS plans, free cap, usage | Over limit blocks new, never deletes | Yes |

**After slice 3, give it to one friendly teacher for free.** Their real use will change your priorities more than any plan.

### When to add the worker (`apps/worker`)
At slice 10, not before. Until then, generate PDFs and invoices inside the API request. Move work to BullMQ when it is slow or needs retries.

### Money and attendance: always
- Inside a DB transaction.
- With a unique constraint that blocks duplicates.
- With an `Idempotency-Key` on the API.
- With a test proving a double submit is safe.

---

## Step 6: Hardening and pilot (last 2–3 weeks)

- Load test scan burst and month-start billing (k6).
- Restore a backup into staging. Time it. Write the steps in `docs/runbooks/restore.md`.
- Error tracking (Sentry) + uptime check.
- Sinhala/Tamil translation review by a native speaker.
- Privacy notice, parent consent text, data deletion process.
- Pilot with 2–5 institutes. Track: support messages per week, tasks people could not finish.

---

## Daily habits of a good lead engineer

1. **Small PRs.** One feature or fix each. Easy to review, easy to revert.
2. **Test the dangerous parts.** Money, permissions, duplicates, tenant isolation. Skip tests for simple display code.
3. **Never edit a deployed migration.** Write a new one.
4. **Deploy often.** At least weekly to staging, and to production after the pilot starts.
5. **Write down why.** ADR for big decisions, a short comment for strange code.
6. **Measure before optimizing.** No Redis cache, read replica or microservice until a metric says so.
7. **Talk to users every week** during the pilot. Ship their top pain first.
8. **Backups are only real if you have restored one.**

---

## Week-by-week summary

| Week | Focus | Output |
|---|---|---|
| 1 | Interviews, accounts, ADRs, repo | Notes + empty monorepo |
| 2 | DB roles, migrations 001–002, RLS, isolation tests | Tenant isolation proven |
| 3 | API auth + tenancy, Next.js shell, **staging deploy + CI** | Signup/login live on staging |
| 4–5 | Students, batches, enrollments, sessions | Receptionist can enroll |
| 6–7 | Cards, scan, offline sync | **Pilot teacher starts using it** |
| 8–10 | Fees, slips, PayHere, payouts, tutes | Money flow complete |
| 11 | Worker, outbox, WhatsApp/SMS | Parents get messages |
| 12–13 | Recorded lessons | Online classes supported |
| 14–15 | Exams, ranks, portals | Students/parents use it |
| 16–17 | Reports, SaaS plans, hardening | Production ready |
| 18+ | Pilot with 2–5 institutes | Real feedback → Phase 2 |

Solo developer? Expect roughly 1.5× these times. Cut slices 11–15 to after the pilot if needed. Attendance and fees alone are already worth paying for.
