# Tuition LMS SaaS — Implementation Plan

**Version:** 1.1 — Sri Lanka market-fit revision  
**Target market:** Sri Lankan physical, online and hybrid tuition classes  
**Preferred stack:** Node.js, Next.js, PostgreSQL, Knex.js migrations  
**Primary objective:** Launch a secure, operationally useful MVP that can scale from individual teachers to multi-branch institutes.

## 1. Product scope and MVP boundaries

> **First release:** v1.0 ships without PayHere and the WhatsApp Cloud API (slip verify + click-to-WhatsApp links instead). See [docs/RELEASE_V1.md](docs/RELEASE_V1.md) for the cut scope. The table below is the full MVP across v1.0 → v2.0.

### MVP — must ship

| Area | MVP capabilities | Acceptance criteria |
|---|---|---|
| SaaS onboarding | Institute/teacher signup, email/phone (OTP) verification, trial, tenant settings; Sinhala/Tamil/English UI | Owner can create institute and first branch without platform support |
| Authentication/RBAC | Login, password reset, owner/admin/teacher/receptionist/student/parent roles; scoped permissions | Cross-role and cross-tenant access denied server-side |
| Institutes | Profile, branding, branch (one initially), staff invitations | Institute data isolated from all other institutes |
| Students & guardians | Student profiles, guardian links, CSV import, duplicate detection, search, unique institute-local student number | Student can belong to multiple institutes without data leakage |
| Academics | Subjects, courses, batches, enrollments, recurring timetable, individual class sessions | Reschedule/cancel individual sessions without corrupting recurrence |
| Attendance | Receptionist scan QR/barcode class card, manual mark, late/absent, duplicate prevention, corrections with audit; **offline scan queue** (PWA) that syncs when connection returns | Repeated scan never creates duplicate attendance; desk keeps scanning during a network/power outage |
| Fees | Monthly and one-off charges with line types `class` / `ac` / `tute` / `admission` / `late`; invoice generation (default: issue on 1st, due on 5th, optional late fee); cash/bank-transfer recording, **free card / half card / sibling concessions**, partial payments, receipt PDF, outstanding balance, **"not paid this month" list** | Ledger and invoice balances reconcile; no double application of payment |
| Online payments | **Bank slip photo upload → staff verify/reject**; PayHere hosted checkout (cards, LankaQR, eZ Cash) with webhook verification | Payment affects balance only after verification; duplicate webhooks/slips are safe |
| Teacher payouts | Per-teacher/per-batch rule: teacher % share (typical 30–50% when the institute brings the students, higher when the teacher does), or a fixed hall rent the teacher pays the institute; monthly payout statement from verified collections | Payout statement reconciles to verified collections for the period |
| Recorded lessons & live links | Upload/link lessons per batch via managed video provider; live class join links **issued per student only after payment** (no shared group link); access only for students with paid month; per-student visible watermark (student number + phone); concurrent-device limit; expiry date | Unpaid or expired student cannot play or join; shared link fails for other accounts |
| Tutes / materials | Tute items per batch/month, mark handed out at desk or on scan, PDF materials with signed download | Receptionist sees which students have not received this month's tute |
| Notifications | In-app notices, **WhatsApp Business (Cloud API) templates** as primary channel, SMS fallback, queued delivery, attendance/fee/result templates | Failed delivery can retry without duplicating business action; fallback to SMS when WhatsApp fails |
| Assessments | Simple MCQ tests, question bank, attempts, auto-scoring; **paper-exam marks entry (bulk/CSV)**; **class rank lists**; published results | Teacher can publish results and ranks; students only see authorized results |
| Portals | Owner/admin, teacher, receptionist, student and parent responsive dashboards | Each role sees only relevant tenant-scoped data |
| Reporting | Attendance, fee collection, outstanding fees, enrollment, basic exam performance; CSV export | Reports respect tenant, branch, date and role filters |
| SaaS billing | **Free plan for solo teachers** (student cap, e.g. 50), paid plans, trial dates, entitlements, usage counters (students, WhatsApp/SMS, video GB), manual subscription activation initially | Expired plan behavior is predictable and non-destructive |
| Operations | Monitoring, audit logs, backups, restore drill, CI/CD, API documentation | Production deployment has tested rollback and restore |

### Deliberately out of MVP

Native mobile apps, NFC hardware, payroll beyond revenue-share statements (EPF/ETF, salaried staff), advanced accounting, AI grading, AI tutors, custom domains, white-label themes, **self-hosted video transcoding or full Widevine/FairPlay DRM** (use a managed provider's signed playback instead), automated A/L Z-score, island-wide rankings, public marketplace, advanced website builder, and multi-branch operations UI. **Design schema and authorization to accommodate multiple branches from day one**, but ship single-branch workflows first. Live Zoom/Meet integration, assignments and multi-branch UI are Phase 2.

### Why these are MVP in Sri Lanka

- **WhatsApp** is where parents and students actually read messages; SMS is the fallback, email is rarely read.
- **Bank slip upload + PayHere** — online and hybrid classes cannot run on cash; slip verification is today's real workflow.
- **Protected recorded lessons** — the core product of A/L online classes and the biggest revenue leak (link/video sharing). Watermark + paid-month access is the main differentiator.
- **Teacher revenue share** — every institute settles with teachers by percentage; owners will not switch without it.
- **Free/half card, paper marks, class ranks, tutes** — daily routines in almost every class.
- **Offline desk** — power cuts and weak connections must not stop class entry.

## 2. Architectural decisions

**Recommended deployment:** TypeScript monorepo with a **modular monolith API** and separate Next.js web app. Start with one deployable API rather than microservices. Extract services only when independent scaling or organizational ownership justifies it.

```text
Browser / PWA
    |
    v
CDN / WAF / TLS
    |
    +--> Next.js Web (SSR + client UI)
    |        |
    |        +--> BFF/server actions where useful
    |                 |
    +----------------> Node.js API (Fastify + TypeScript)
                         |
          +--------------+------------------+
          |              |                  |
       PostgreSQL      Redis          S3-compatible storage
          |              |
          |          BullMQ workers ------> WhatsApp / SMS / Email / PDF
          |
      PgBouncer (when connection counts warrant it)

External: PayHere (hosted checkout + webhooks), managed video provider
(e.g. Bunny Stream / Cloudflare Stream / Mux — signed playback tokens)
```

**Keep MVP infra lean:** one managed PostgreSQL, one Redis, API + worker + web containers on a single host or small PaaS. Add PgBouncer, Terraform, separate worker pools and read replicas only when metrics demand them. Do not build video transcoding or a payment page in-house.

**Framework choices:** Next.js App Router + TypeScript + Tailwind; Fastify + TypeScript + Zod/OpenAPI; PostgreSQL; Knex for SQL queries, transactions, migrations and seeds; Redis + BullMQ; S3-compatible object storage. Avoid coupling business logic to Next.js route handlers. Prefer server-side API authorization over client-side permission checks.

### Repository structure

```text
tuition-lms/
  apps/
    web/                    # Next.js: public site + all role dashboards
    api/                    # Fastify HTTP API
    worker/                 # BullMQ jobs: notifications, invoices, exports
  packages/
    db/                     # Knex config, migrations, seeds, query helpers
    contracts/              # Zod schemas, DTOs, shared enums/types
    auth/                   # permissions, session helpers
    ui/                     # shared components/design tokens
    config/                 # env validation, feature flags
  infra/
    docker/
    nginx/
    terraform/              # optional later
  docs/
    adr/                    # architecture decision records
    api/
    runbooks/
  .github/workflows/
```

### API modules (bounded contexts)

`identity`, `tenancy`, `staff`, `students`, `academics`, `attendance`, `billing`, `payouts`, `content` (recorded lessons, tutes, materials), `assessments`, `notifications`, `reports`, `subscriptions`, `audit`, `files`.

Each module owns routes, service/use cases, repositories, validation schemas and tests. Cross-module changes happen through explicit service calls or transactional domain events; avoid circular imports.

## 3. Multi-tenant strategy — critical design

### Recommended model

**Shared PostgreSQL database, shared schema, tenant-scoped rows (`tenant_id`) with PostgreSQL Row-Level Security (RLS) as defense in depth.** This is cost-effective for many small and medium institutes and easier to migrate and operate than one database per tenant.

- `tenants` represents an institute or independent teacher organization.
- `branches` belongs to a tenant; all tenant-owned operational tables carry `tenant_id`.
- `users` represents global login identity, **not** ownership of institute records.
- `tenant_memberships` associates a user with a tenant and roles; a user may join multiple tenants.
- `students` should be **tenant-owned student records**; `student_user_id` can optionally link the same global login to records in different institutes. Never share private student records between tenants implicitly.
- Guardian relationships are tenant-scoped and access-checked. One guardian account can have links in multiple tenants.
- SaaS/platform admins are separate privileged actors; ordinary tenant admins must never access platform-wide data.

### Tenant resolution and trust boundary

1. Authenticate user using secure session cookie (HttpOnly, Secure, SameSite) or carefully managed tokens.
2. Select tenant via route (`/t/:tenantSlug/...`) or tenant selector; a tenant header is only a **requested context**, never authority.
3. Verify active membership and permission for that tenant (and branch, where applicable).
4. Create a DB transaction, set `SET LOCAL app.tenant_id = '<validated uuid>'` (using parameter-safe `set_config`), execute all tenant-scoped queries within **the same transaction/connection**.
5. RLS policy checks `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
6. Return generic 404 for inaccessible tenant resources where appropriate. Log denied access without leaking PII.

**Never** use a PostgreSQL superuser or `BYPASSRLS` role for the runtime API. Table owners normally bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled; use separate migration-owner and restricted application roles, and force RLS on tenant tables. Workers must establish tenant context for every tenant-scoped job. Avoid session-level `SET` with pooled connections.

### Example PostgreSQL RLS (illustrative)

```sql
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

CREATE POLICY students_tenant_policy ON students
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

The app role needs appropriate grants but cannot own the table. Tenant authorization remains mandatory at API layer; RLS is not a substitute for checking student/guardian/teacher relationships.

### Tenant isolation test matrix

- User in Tenant A cannot read/update/delete Tenant B data by guessing IDs.
- A user belonging to A and B sees only selected tenant's data per request.
- Parent can access only explicitly linked child records.
- Teacher cannot access unassigned batch/student data unless granted.
- Background jobs, exports, file downloads and reports preserve tenant context.
- Missing/invalid tenant context returns zero rows or fails closed.
- SQL joins, bulk updates, search, aggregate queries and foreign keys cannot cross tenants.

## 4. Database architecture

### Conventions

- PostgreSQL UUID primary keys (`gen_random_uuid()`); `timestamptz` UTC timestamps.
- Tenant-owned tables: `id`, `tenant_id`, `created_at`, `updated_at`, optional `deleted_at`.
- Use `numeric(12,2)` for LKR amounts, never floating-point money; currency column for future flexibility.
- All externally visible identifiers are opaque UUIDs; institute-local display numbers can be separate.
- Prefer explicit status constraints and `CHECK`s; avoid ambiguous booleans.
- Foreign keys include tenant scope where possible: `UNIQUE (tenant_id, id)` on parent, composite `(tenant_id, parent_id)` FK on child.
- Index `(tenant_id, ...)` based on actual filters; include partial indexes for active rows and unique constraints for business invariants.
- For auditability, financial entries are immutable or adjusted with reversing entries; do not hard-delete posted transactions.
- Sensitive student data encrypted in transit and at rest; minimize collection and apply retention/deletion policies.

### Core entities and relationships

```text
users ──< tenant_memberships >── tenants ──< branches
  |                                 |
  +──< student_user_links >── students ──< enrollments >── batches
  |                                 |                          |
  +──< guardian_student_links >─────+                          +──< class_sessions
                                                             |         |
subjects ──< courses ────────────────────────────────────────+         +──< attendance
                                  |
                                  +──< assessments ──< questions
                                                    └──< attempts ──< answers
students ──< invoices ──< invoice_lines
     |            └──< payment_allocations >── payments
     +──< notifications
subscriptions >── plans
```

### Table inventory — MVP

| Domain | Tables | Key notes |
|---|---|---|
| Identity | `users`, `auth_sessions`, `password_reset_tokens`, `email_verifications` | Global identities; hashed tokens; session revocation |
| Tenancy | `tenants`, `branches`, `tenant_memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles` | Tenant-local roles; platform roles separate |
| Students | `students`, `guardians`, `guardian_student_links`, `student_user_links`, `student_import_jobs` | Tenant-owned records; verified guardian linking |
| Academics | `subjects`, `courses`, `batches`, `enrollments`, `schedule_rules`, `class_sessions`, `class_rooms` | Session is source of truth for attendance |
| Attendance | `attendance_records`, `attendance_corrections`, `student_cards` | Unique `(tenant_id, session_id, student_id)`; revocable cards; `client_scan_id` for offline sync idempotency |
| Fees | `fee_plans`, `fee_concessions`, `student_fee_assignments`, `invoices`, `invoice_lines`, `payments`, `payment_allocations`, `payment_slips`, `payment_gateway_events`, `refunds`, `receipts` | Concession type `free_card`/`half_card`/`sibling`/`custom`; slips and gateway events feed `payments` as `pending` until verified |
| Payouts | `teacher_payout_rules`, `teacher_payout_statements`, `teacher_payout_lines` | Rule by teacher/batch with % or fixed per student; statements immutable once approved |
| Content | `lessons`, `lesson_videos`, `lesson_access_rules`, `video_playback_sessions`, `tute_items`, `tute_distributions`, `materials` | Access derived from paid invoices; playback sessions enforce device limit; unique `(tenant_id, tute_item_id, student_id)` |
| Assessments | `assessments`, `questions`, `question_options`, `assessment_questions`, `assessment_attempts`, `attempt_answers`, `manual_marks`, `results` | Version questions for published exams; rank computed at publish time and stored on `results` |
| Communications | `notification_templates`, `notifications`, `notification_deliveries`, `outbox_events` | Idempotent asynchronous sending |
| SaaS | `plans`, `plan_entitlements`, `subscriptions`, `subscription_events`, `tenant_usage` | Separate platform billing from student tuition fees |
| Operations | `audit_logs`, `files`, `export_jobs`, `idempotency_keys` | Signed file access; audit sensitive mutations |

### Critical constraints and indexes

```sql
-- Examples, adapt to actual schema names and status rules
UNIQUE (tenant_id, branch_id, student_number)
UNIQUE (tenant_id, batch_id, student_id)           -- or partial unique for active enrollments
UNIQUE (tenant_id, session_id, student_id)         -- one attendance record per session
UNIQUE (tenant_id, invoice_number)
UNIQUE (tenant_id, provider, provider_reference)   -- for external payment references (PayHere order/payment id)
UNIQUE (tenant_id, client_scan_id)                 -- offline scan replay is idempotent
UNIQUE (tenant_id, tute_item_id, student_id)       -- one tute handout per student
UNIQUE (tenant_id, teacher_id, period)             -- one payout statement per teacher per month
INDEX  (tenant_id, batch_id, starts_at)            -- class sessions
INDEX  (tenant_id, student_id, status, due_at)     -- invoices
INDEX  (tenant_id, student_id, recorded_at)        -- attendance
INDEX  (tenant_id, created_at)                     -- audit logs
```

**Financial model:** An invoice can have many lines; a payment can be allocated across invoices. Maintain payment status (`pending`, `verified`, `failed`, `reversed`) separately from invoice status (`draft`, `issued`, `part_paid`, `paid`, `void`). A payment only affects balance once verified. Enforce `sum(allocations) <= verified payment amount` transactionally and use row locking for concurrent collection. Consider a double-entry ledger in Phase 2 if accounting scope grows.

### Knex migrations

- Migrations are append-only once deployed. Never rewrite production migration history.
- Migrations run under a dedicated owner role in CI/CD deployment, not at every app boot.
- Use transactional migrations where PostgreSQL permits; document exceptions (e.g. concurrent index creation).
- Backward-compatible **expand → migrate/backfill → contract** releases; deploy application code compatible with old/new schema during rollout.
- Add seed data for plans, permissions, demo tenant and test users; never seed real credentials into production.
- Check migrations in CI against an empty database and an upgraded previous schema.

**Illustrative Knex migration:**

```ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await knex.schema.createTable('tenants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('slug', 80).notNullable().unique();
    t.string('name', 200).notNullable();
    t.string('status', 24).notNullable().defaultTo('trial');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('students', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants');
    t.string('student_number', 50).notNullable();
    t.string('full_name', 200).notNullable();
    t.string('status', 24).notNullable().defaultTo('active');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'student_number']);
    t.unique(['tenant_id', 'id']);
    t.index(['tenant_id', 'status']);
  });
  await knex.raw('ALTER TABLE students ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE students FORCE ROW LEVEL SECURITY');
  await knex.raw(`CREATE POLICY students_tenant_policy ON students
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('students');
  await knex.schema.dropTableIfExists('tenants');
}
```

**Note:** This is a minimal pattern, not the entire schema. Implement RLS for every tenant-owned table, and separately handle global platform tables.

### Safe tenant-scoped query pattern

```ts
async function withTenant<T>(
  knex: Knex,
  authorizedTenantId: string,
  work: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return knex.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [authorizedTenantId]);
    return work(trx);
  });
}

// authorizedTenantId must come from validated membership, not an unchecked request header.
// All repositories inside `work` MUST use `trx`, never the global knex instance.
```

## 5. API design and business workflows

### API conventions

- Prefix `/api/v1`; REST resources; OpenAPI generated from shared validation schemas.
- Cursor pagination for high-volume lists; limit and filter validation.
- Use `Idempotency-Key` for payment collection, enrollment imports and attendance write endpoints where relevant.
- Request ID and structured logs; consistent error shape `{code, message, requestId, details?}`.
- Never accept `tenant_id` from body as proof of access; derive authorized context.

### Example endpoints

```text
POST   /api/v1/auth/login
POST   /api/v1/tenants
GET    /api/v1/tenants/:tenantId/dashboard
POST   /api/v1/tenants/:tenantId/students
GET    /api/v1/tenants/:tenantId/students
POST   /api/v1/tenants/:tenantId/batches
POST   /api/v1/tenants/:tenantId/batches/:id/enrollments
POST   /api/v1/tenants/:tenantId/sessions/:id/attendance/scan
PATCH  /api/v1/tenants/:tenantId/attendance/:id
POST   /api/v1/tenants/:tenantId/invoices/generate
POST   /api/v1/tenants/:tenantId/payments
POST   /api/v1/tenants/:tenantId/payment-slips             # student uploads slip
POST   /api/v1/tenants/:tenantId/payment-slips/:id/verify  # staff verify/reject
POST   /api/v1/webhooks/payhere                            # signature-verified, idempotent
POST   /api/v1/tenants/:tenantId/attendance/sync           # offline scan batch
POST   /api/v1/tenants/:tenantId/lessons/:id/playback      # returns short-lived signed token
POST   /api/v1/tenants/:tenantId/tutes/:id/distributions
POST   /api/v1/tenants/:tenantId/payouts/generate
POST   /api/v1/tenants/:tenantId/assessments/:id/marks     # paper-exam marks (bulk)
GET    /api/v1/tenants/:tenantId/reports/collections
POST   /api/v1/tenants/:tenantId/assessments
POST   /api/v1/tenants/:tenantId/assessments/:id/attempts
POST   /api/v1/tenants/:tenantId/assessments/:id/publish-results
```

### Attendance scan transaction

1. Verify authenticated staff, tenant membership, branch and permission.
2. Resolve card token to tenant student (token is random, revocable; never contains PII).
3. Validate active enrollment and correct session/time window.
4. Insert attendance with `ON CONFLICT` policy (idempotent duplicate scan).
5. Insert outbox notification event **in the same DB transaction**.
6. Commit; worker asynchronously sends notification and records delivery state.
7. Return student name, class, attendance state and fee warning (warning does not silently block entry).

### Monthly fee generation transaction

1. Select eligible active enrollments and fee plans for billing period.
2. Generate stable billing key `(tenant, enrollment, fee_plan, period)`.
3. Insert invoice/lines with unique billing key; rerun is safe.
4. Apply configured discounts/exemptions; calculate totals using decimal math.
5. Record audit event and outbox reminder; send asynchronously.
6. On verified payment, allocate transactionally and issue receipt.

### Bank slip / PayHere payment flow

1. Student/parent uploads slip image (or completes PayHere checkout) against an invoice.
2. Create `payments` row with status `pending`; slip image stored privately.
3. Slip: staff views image, enters bank reference, verifies or rejects. PayHere: webhook with valid MD5 signature marks it verified; duplicate webhooks hit `UNIQUE (provider, provider_reference)`.
4. On verify: allocate to invoice(s), issue receipt, unlock lesson access for that month, outbox WhatsApp receipt.
5. Rejected slip notifies the student with reason; no balance change.

### Offline attendance sync

1. Desk PWA caches today's sessions and active card tokens for the branch.
2. Offline scans stored in IndexedDB with a client-generated `client_scan_id` and device timestamp.
3. On reconnect, batch POST to `/attendance/sync`; server validates each as a normal scan; `UNIQUE (tenant_id, client_scan_id)` makes replays safe.
4. Conflicts (revoked card, wrong session) returned per item for receptionist review.

### Recorded lesson access

1. Student requests playback; server checks enrollment + verified payment for the lesson's month + expiry.
2. Enforce device limit via active `video_playback_sessions` (e.g. 2 concurrent); new session revokes oldest or is refused per tenant setting.
3. Return short-lived signed token from video provider; player overlays student number + phone as moving watermark.
4. Log playback for teacher view counts and abuse review. Watermarking is deterrence, not DRM; state this clearly to teachers.

### Monthly teacher payout

1. For period, sum verified allocations per batch (cash + slip + PayHere), minus refunds.
2. Apply `teacher_payout_rules` (% share or fixed per paying student); free cards contribute zero.
3. Generate draft statement; owner approves → immutable; corrections via adjustment lines next period.

## 6. Scale and reliability design

**Scale assumptions to validate:** launch at 10–50 institutes, grow to 500+; 100–2,000 students per institute; bursty check-ins before classes; heavy month-start billing. These are planning assumptions, not demand forecasts.

| Layer | MVP approach | Scale-up trigger/strategy |
|---|---|---|
| Web | Stateless Next.js behind CDN | Add replicas, cache public pages |
| API | Stateless Fastify, horizontal replicas | Autoscale on CPU/latency/queue pressure |
| Database | Managed PostgreSQL or tuned dedicated PG; proper indexes | PgBouncer, read replicas for reporting, query optimization |
| Jobs | Redis + BullMQ separate worker process | Separate notification, billing and export worker pools |
| Files | S3-compatible object storage | Signed URLs, CDN for authorized public assets |
| Video | Managed video provider, signed playback | Per-tenant storage/bandwidth metering; pass cost through plans |
| Messaging | WhatsApp Cloud API + SMS fallback | Per-tenant message quotas; cost metering in `tenant_usage` |
| Reporting | Indexed SQL aggregates | Materialized summaries / async report generation |
| Search | PG full-text/trigram search | Dedicated search only when justified |
| Large tables | Standard indexed tables | Time partition attendance/audit logs after measurements |
| Tenant size | Shared schema | Consider dedicated DB for exceptional tenants only after operational need |

### Non-functional targets (initial SLOs)

- Availability target: 99.9% monthly **after stabilization**.
- Typical API read p95 < 300 ms at representative load; attendance write p95 < 500 ms (excluding SMS).
- Support 100 concurrent check-in requests in a load test with no duplicate attendance.
- RPO target <= 24 hours initially, improve to <= 1 hour with PITR; RTO target <= 4 hours after documented restore drill.
- Accessibility: WCAG 2.2 AA as a design target; Sinhala/Tamil/English text support; low-bandwidth UI.
- Measure before optimizing: DB slow queries, connection saturation, queue age, error rate, p95 latency, payment reconciliation discrepancies.

### Operational safeguards

- DB transactions for financial/attendance writes; retries only for idempotent operations.
- Outbox pattern to avoid committing business data without corresponding notification event.
- Dead-letter/failed-job review; exponential backoff; provider rate limits.
- Point-in-time recovery if supported, encrypted backups, periodic restore tests.
- Feature flags, staged rollouts, backwards-compatible DB migrations.
- Privacy-conscious observability: no passwords, auth tokens, or sensitive student fields in logs.

## 7. Security, privacy and compliance

- Threat-model student records, guardian relationships, staff impersonation, payment fraud, card sharing and tenant escape.
- Use Argon2id for password hashing; protect cookies with CSRF defenses; optional MFA for owners/admins.
- Strict validation and authorization on **every** route and file download; signed short-lived private file URLs.
- Rate-limit login, student search, attendance scans and public enrollment.
- Use least-privilege DB credentials, secrets manager/environment injection, rotation procedures.
- Record immutable audit events for fee edits, payment verification, attendance corrections, role changes and exports.
- Define guardian verification/consent, data retention, deletion/export and incident response procedures.
- Review applicable Sri Lankan Personal Data Protection Act requirements with local counsel; avoid claiming compliance solely through technical controls.
- PCI scope: PayHere hosted checkout only; never store raw card numbers/CVV. Verify webhook signatures and amounts server-side.
- Payment slips can be forged or reused: store image hash, flag duplicate hashes/references, require staff verification.
- WhatsApp: send only to opted-in numbers using approved templates; respect opt-out.

## 8. Frontend information architecture

```text
Public: landing / pricing / institute signup / login
Platform Admin: tenants / subscriptions / usage / support / system health
Tenant Owner: overview / branches / staff / students / academics / fees / payouts / reports / settings
Receptionist: quick scan (offline-capable) / student lookup / collect fee / verify slips / tute handout / receipt / daily summary
Teacher: my batches / sessions / attendance / lessons & tutes / exams & marks / ranks / my payout / announcements
Student: my classes / timetable / recorded lessons / attendance / invoices & pay / upload slip / exams / results & rank
Parent: linked children / attendance / fees & pay / timetable / results & rank
```

**UX priorities:** Receptionist quick scan and payment flows should work in a few interactions; search by name, institute student number, or card; provide keyboard shortcuts and clear success/error states. Design mobile-first but optimize reception desk workflows for desktop/barcode scanners.

## 9. Testing and quality gates

| Test type | Required coverage |
|---|---|
| Unit | Fee + concession calculations, payout rules, rank ties, scheduling recurrence, exam scoring, permission checks |
| Integration | Knex repositories, transactions, RLS, FK constraints, payment allocations, PayHere webhook replay, offline sync replay, lesson access after/without payment |
| API | Auth, RBAC, validation, pagination, idempotency, rate limits |
| E2E | Institute onboarding → enroll student → scan → invoice → pay → receipt → exam |
| Tenant security | Cross-tenant reads/writes/joins, workers, exports, files, guardians |
| Load | Class start attendance burst, month-start invoice generation, reporting |
| Recovery | Restore from backup, migration rollback/forward fix, queue replay |
| Accessibility | Keyboard operation, contrast, screen-reader labels, Sinhala/Tamil fonts |

CI gates: TypeScript typecheck, lint, unit tests, integration tests against PostgreSQL/Redis containers, migration smoke test, dependency scan, build and E2E smoke suite. Do not deploy failing migrations or tenant-isolation tests.

## 10. Delivery roadmap (16–24 weeks for a small experienced team; longer if solo — adjust after discovery)

### Sprint 0 — Discovery and foundations (1–2 weeks)
- Interview 5–10 tuition teachers/receptionists across individual, institute and online A/L settings. Ask which MVP features they would pay for; cut anything nobody ranks top 3.
- Confirm fee rules, concession types, teacher revenue-share terms, class recurrence, student identity, parent consent, WhatsApp vs SMS cost, video volume per teacher, expected scan volume.
- Register WhatsApp Business account, PayHere merchant (sandbox), video provider account early — approvals take time.
- Define wireframes, API contracts, ADRs, tenant threat model and product success metrics.
- Initialize monorepo, Docker dev stack, CI, environment validation, migrations.

### Sprint 1 — Identity and tenancy (2 weeks)
- Users, login, sessions, tenant onboarding, memberships, roles, RLS middleware.
- Test cross-tenant access and tenant switching.
- **Exit:** Two tenants operate with no shared private data.

### Sprint 2 — Students and academics (2–3 weeks)
- Student/guardian records, imports, subjects, courses, batches, enrollments, recurring sessions.
- **Exit:** Receptionist can enroll a student into a scheduled batch.

### Sprint 3 — Attendance, cards and tutes (2–3 weeks)
- QR/barcode IDs, scan UI, attendance transaction, corrections, daily report, outbox.
- Offline scan queue + sync endpoint; tute handout on scan/desk.
- **Exit:** 100 concurrent scans tested; duplicates prevented; offline replay creates no duplicates.

### Sprint 4 — Fees, payments and payouts (3 weeks)
- Fee plans, invoices, free/half/sibling concessions, verified manual payments, partial allocations, PDF receipts, audit.
- Bank slip upload + verification queue; PayHere hosted checkout + webhook.
- Teacher payout rules and monthly statements.
- **Exit:** Monthly billing can safely rerun; balances and payout statements reconcile; webhook replay is safe.

### Sprint 5 — Recorded lessons (2 weeks)
- Video provider integration, lesson upload/link per batch, paid-month access, watermark overlay, device limit, view logs.
- **Exit:** Unpaid student cannot play; paid student can on 2 devices max; watermark visible.

### Sprint 6 — Exams, portals, notifications (2–3 weeks)
- MCQ exam flow, paper-marks bulk entry, class ranks, results; student/parent/teacher views.
- WhatsApp template adapter (primary), SMS fallback, email; retry queue.
- **Exit:** Teacher publishes marks and ranks; parent gets WhatsApp result and sees authorized child data.

### Sprint 7 — Hardening and pilot (2–3 weeks)
- Reporting, subscription entitlements (free plan cap, message/video quotas), load tests, accessibility, Sinhala/Tamil translations, backups, incident runbooks.
- Pilot with 2–5 institutes (at least one online A/L teacher), measure task completion and support tickets.
- **Exit:** Production checklist passes and pilot staff can run a real class day.

### Phase 2 — After validated MVP
- Zoom/Meet live class integration with attendance; assignments; multiple-branch UI; advanced commissions (tiers, bonuses, hall rent deductions); automated bank statement reconciliation; custom institute landing pages; Android app wrapper (PWA/TWA) for students.

### Phase 3 — Only with demand
- Native mobile apps, NFC terminals, advanced analytics, dedicated large-tenant deployments, advanced online exams, AI study tools.

## 11. First migration order

1. `001_extensions_and_platform_users`
2. `002_tenants_branches_memberships_roles`
3. `003_students_guardians_and_links`
4. `004_subjects_courses_batches_enrollments`
5. `005_schedule_rules_and_class_sessions`
6. `006_student_cards_attendance_and_corrections`
7. `007_fee_plans_concessions_invoices_payments_allocations`
8. `008_payment_slips_and_gateway_events`
9. `009_teacher_payout_rules_and_statements`
10. `010_lessons_videos_playback_tutes_materials`
11. `011_assessments_questions_attempts_marks_results`
12. `012_notifications_outbox_and_deliveries`
13. `013_plans_subscriptions_entitlements_usage`
14. `014_files_audit_logs_exports_idempotency`
15. `015_rls_policies_indexes_and_constraints`

**Caution:** Apply RLS policies **in the same migration as each tenant-owned table** before exposing that table to the application. The final migration above is a verification/hardening pass, not a reason to defer RLS.

## 12. Definition of done — production MVP

- [ ] Each role can complete its critical workflow on desktop and mobile.
- [ ] Tenant isolation verified in API, SQL, files, background jobs and exports.
- [ ] Receptionist can register, enroll, scan, collect fee and issue receipt.
- [ ] Duplicate scans, duplicate invoices and duplicate payment submissions are safe.
- [ ] Student and guardian see only authorized data.
- [ ] Teacher can create/publish MCQ exam, enter paper marks and publish class ranks.
- [ ] Student can pay by slip or PayHere; lesson access unlocks only after verification.
- [ ] Recorded lessons enforce paid-month access, watermark and device limit.
- [ ] Owner can generate and approve teacher payout statements that reconcile to collections.
- [ ] Desk scanning works offline and syncs without duplicates.
- [ ] Attendance, fee and result notifications delivered via WhatsApp with SMS fallback.
- [ ] Core screens available in Sinhala, Tamil and English.
- [ ] Backups restore successfully into staging; rollback/forward-fix procedure documented.
- [ ] Audit logs cover financial changes, attendance corrections and permission changes.
- [ ] Performance tested against realistic class-start and month-start load.
- [ ] Subscription limits enforced server-side without deleting customer data.
- [ ] Support, privacy notices, consent and data-retention procedures prepared.
- [ ] Pilot institutes approve core workflows and critical bugs are resolved.

## 13. Recommended implementation priorities

**P0:** Tenant isolation, auth/RBAC, student/class/enrollment, sessions, attendance (incl. offline), fees/concessions/payments/receipts, slip verification, audit and backups.  
**P1:** PayHere, teacher payouts, protected recorded lessons, WhatsApp notifications, parent/student portal, exams with paper marks and ranks, tutes, reporting, SaaS subscriptions incl. free plan.  
**P2:** Live class integration, assignments, multi-branch UI, advanced commissions, bank reconciliation.  
**P3:** AI, native apps, NFC, white-label and marketplace.

**Architecture principle:** Build a secure, well-indexed modular monolith with strong transaction boundaries and tenant isolation first. Scale stateless application processes and background workers independently; split into microservices only when measured constraints justify the complexity.
