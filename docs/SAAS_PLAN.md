# Tuition LMS: SaaS accounts, per-head billing, trials and super admin

**Status:** Implementation plan. Decisions made 2026-10-17 ([§14](#14-decisions-made-2026-10-17)); ready for Phase 1. Nothing here is built yet. Revised 2026-10-17 against commit `1eddccb`: pricing changed from flat plans to **per-head monthly pricing**.
**Replaces when built:** the per-institute plan in `apps/api/src/lib/plans.ts` and the hand-run SQL in [runbooks/plans.md](runbooks/plans.md).
**Supersedes:** the flat pricing in [ADR 008](adr/008-segment-and-pricing.md). Recorded as [ADR 009](adr/009-per-head-pricing.md).
**Related ADRs:** [001 modular monolith](adr/001-modular-monolith.md), [002 shared DB + RLS](adr/002-shared-db-rls.md), [005 payments](adr/005-payments-institute-merchant.md), [006 WhatsApp first](adr/006-whatsapp-first.md).

---

## Contents

1. [Summary](#1-summary)
2. [What exists today](#2-what-exists-today)
3. [How SaaS products do this (research)](#3-how-saas-products-do-this-research)
4. [Architecture principles](#4-architecture-principles)
5. [Domain model](#5-domain-model)
6. [Pricing and metering](#6-pricing-and-metering)
7. [Entitlements engine](#7-entitlements-engine)
8. [Data model and migrations](#8-data-model-and-migrations)
9. [Code layout](#9-code-layout)
10. [Super admin console](#10-super-admin-console)
11. [Implementation phases](#11-implementation-phases)
12. [How to extend it later](#12-how-to-extend-it-later)
13. [Risks and mitigations](#13-risks-and-mitigations)
14. [Decisions](#14-decisions-made-2026-10-17)

---

## 1. Summary

Today each institute has its own flat plan, there is one limit (active students), plans are changed by running SQL on the server, and no one can see all institutes in one place.

This plan changes the business model to **pay per head, per month**. Each customer is billed for the most students, teachers and parents they had that month, at prices the super admin sets:

| Head | Default price (LKR / month) | Example |
|---|---|---|
| Active student | 100 | 120 students → 12,000 |
| Teacher | 2,000 | 3 teachers → 6,000 |
| Parent with app access | 50 (or 0 = free) | 80 parents → 4,000 |
| **Monthly bill** | | **22,000** |

Every price can be changed globally, per price book, or **per customer**, without a deploy.

It builds four things, structured so later features (card payments, SMS credits, add-ons, team accounts) fit without rework:

1. **Customer account above institutes.** The account is who pays. It owns one or more institutes; its head counts are added up across them.
2. **Metering and monthly invoices.**
   - The database records head counts automatically whenever they change.
   - On the 1st of each month the super admin generates last month's invoices with one click: the peak count of each head type × its price.
   - Customers pay by bank transfer, as today, and the admin records the payment.
3. **Entitlements engine.**
   - Feature switches: bank slips, live links, reports, CSV import, portal.
   - Optional safety caps, e.g. a trial capped at 100 students.
   - Overdue rules.
   - One module answers "is this allowed?", and the API enforces it.
4. **Super admin console** at `/admin` to:
   - create customer accounts;
   - set prices per customer;
   - generate and see invoices;
   - record payments;
   - extend trials;
   - override any feature or cap;
   - suspend accounts.

   Everything is audited, and the console never shows student personal data.

New customers get a **30-day free trial**: nothing is billed for the trial days, and nothing is deleted at any point.

---

## 2. What exists today

Findings from reading the code. The design depends on each of these.

| Area | Today | Consequence for this design |
|---|---|---|
| Shape | Modular monolith: Fastify API with one folder per feature (`apps/api/src/modules/*`), Next.js web, shared `packages/db` ([ADR 001](adr/001-modular-monolith.md)). | Add two modules (`billing`, `platform`) and one plugin. No new service. |
| Tenancy | `tenants` = institutes. `/tenants/:tenantId/*` routes run `loadTenant`, which checks an active membership and sets `req.tenant` (`plugins/tenant.ts`). | Entitlement checks hang off `req.tenant`. |
| Isolation | Every tenant table has `tenant_id` with RLS **enabled and forced**. The API role is `NOBYPASSRLS`, and context is set per transaction by `withTenant` (`packages/db/src/context.ts`). | Counting across a customer's institutes can't be one query ([§7.4](#74-counting-across-institutes-under-rls)). Metering is recorded per institute inside its own context ([§6.3](#63-metering-how-head-counts-are-recorded)). |
| Global tables | `users`, `auth_sessions`, `tenants` have no RLS; access is checked in the API. | `accounts`, price books, invoices, usage and audit tables follow the same pattern. They hold counts and money, never student names. |
| Who is who | Students are rows in `students` (status `active`/`inactive`). Staff and families are `tenant_memberships` with roles in `membership_roles` (`owner`, `admin`, `teacher`, `receptionist`, `student`, `parent`). | Billable heads map directly: **students** = active `students` rows; **teachers** = active memberships with role `teacher`; **parents** = active memberships with role `parent`. |
| Plans | `tenants.plan` + `plan_expires_at` (migration 011). `lib/plans.ts` hard-codes `STUDENT_LIMITS`. | Replaced by billing; the columns are dropped at the end (expand → contract). |
| Limit checks | `assertStudentCapacity` in `students/routes.ts` (create, restore) and `students/import.ts`, under a per-tenant advisory lock. | Generalised to `assertCapacity(kind)`, which only matters when a cap is set. |
| Creating institutes | `POST /tenants`: any logged-in user, unlimited, creator becomes `owner`. | This is where an account is found or created. |
| Money | Fee payments use `numeric`, `lib/money.ts`, and `client_ref` for double-submit safety. Slip upload and approval exist for students' fees. | Subscription invoices and payments reuse the same patterns. |
| Background jobs | None (worker "later", ADR 001). Messages are WhatsApp links a person taps (ADR 006). | No job is needed: state is derived on read, metering happens on write, and invoices are generated from a console button. |
| Deploys | `production` → CI → migrate with the new image (owner role) → restart. Migrations must not break the running old code. | Each phase is expand-only; old plan columns are dropped last. |
| Tests | Vitest with real PostgreSQL. App built with the restricted role, seeded with the owner role (e.g. `apps/api/test/plans.test.ts`). | Integration tests for every rule, and pure unit tests for pricing and state. |
| Web | `DashboardShell` loads `GET /tenants/:id` into `TenantDataContext`. Menu items come from `lib/nav.ts`. Errors are translated by code. | Shell gets `entitlements`; a new **Billing** page shows this month's estimate and invoices. |

---

## 3. How SaaS products do this (research)

### 3.1 Who pays vs where the work happens

B2B SaaS separates the **customer account** (pricing, invoices, limits) from the **workspaces** it owns (here: institutes):

```
Platform (super admin)
└── Account          ← price book, trial, invoices, payments, overrides
    ├── Institute A  ← students, classes, fees, attendance (today's tenant, unchanged)
    └── Institute B
```

### 3.2 Per-seat billing: what counts, and when

Three ways to count heads in a month are common ([Ordway](https://ordwaylabs.com/blog/high-water-mark-billing/), [Bunny](https://docs.bunny.com/guide/best-practices/pricing-by-number-of-users), [Atlassian](https://www.atlassian.com/blog/company-news/maximum-quantity-billing), [Cal.com](https://cal.com/help/billing-and-usage/seat-billing)):

| Method | How it works | Trade-off |
|---|---|---|
| End of period | Count on the billing date | Simplest, but easy to game (deactivate before the 1st) |
| **Peak (high-water mark)** | Highest count during the month; 10 → 15 → 12 bills 15 | Can't be gamed, easy to explain ("the most students you had this month"). Atlassian moved to it |
| Prorated | Each head pays for the days it was active ([Slack](https://slack.com/help/articles/218915077-Slack-s-fair-billing-policy)) | Fairest, but harder to explain and to check by hand |

**Choice: peak per calendar month, billed after the month ends.** Tuition classes grow in waves (new term, exam season). Peak billing is predictable for the customer and simple to verify. The design records daily counts, so switching to prorated later is a calculation change, not a schema change ([§12](#12-how-to-extend-it-later)).

### 3.3 Entitlements

An entitlement answers "can this customer use this right now?" ([Schematic](https://schematichq.com/blog/the-entitlements-layer-how-saas-products-control-customer-access), [Lago](https://www.getlago.com/blog/saas-entitlements)). There are three kinds: feature toggles, quantity caps and metered usage. The sources agree:

- **No plan names in code.** Store values as data ([Dodo Payments](https://dodopayments.com/blogs/entitlement-management-saas/)).
- **Defaults plus per-customer overrides.**
- **One evaluator.**
- **Derive state from facts,** to avoid drift.

### 3.4 Trials

| Question | Research | Choice |
|---|---|---|
| Card up front? | Converts better, fewer sign-ups ([GoCardless](https://gocardless.com/guides/posts/saas-free-trials), [Visionary Marketing](https://visionary-marketing.co.uk/blog/saas-free-trial-conversion-statistics-2026)) | **No card.** Bank transfer only today |
| Length | 14 days often converts better; 30 is most common ([Flint](https://www.flint.com/blog/b2b-saas-free-trial-conversion-rate-statistics), [Insivia](https://www.insivia.com/how-to-improve-saas-free-trial-conversion-rates/)) | **30 days** (setting) |
| At the end | Keep data; restrict or convert ([Servala](https://docs.servala.com/concepts/trials/), [GitLab](https://gitlab.com/gitlab-org/gitlab/-/issues/12186), [Booknetic](https://www.booknetic.com/feature/automated-trial-management)) | **Billing simply starts.** The first invoice covers the days after the trial |
| Missed payment | Grace period with reminders ([OpenMeter](https://openmeter.io/docs/glossary/grace-period)) | 7 days' grace, then no new heads. Suspension is a manual admin step |

### 3.5 Platform admin

Separate platform role, audited console instead of SSH/SQL, server-side scope checks, and impersonation only time-boxed and audited ([NHI](https://nhimg.org/faq/how-should-security-teams-govern-delegated-administration-in-multi-tenant-saas/), [back-office tooling](https://www.skills.sh/peterbamuhigire/skills-web-dev/saas-admin-backoffice-tooling), [ABP](https://abp.io/support/questions/10525/Tenant-Impersonation-By-User)).

---

## 4. Architecture principles

Code review checks against these.

1. **Institutes stay the unit of data isolation; accounts are the unit of billing.** No tenant table gets `account_id`. Only `tenants` points at its account. RLS is unchanged.
2. **Keys in code, values in data.** The catalogue of billable heads, features and caps is a typed TypeScript constant, because code enforces it. Prices, caps and switches are rows, editable without a deploy.
3. **One door.** Other modules call only `billing`'s public functions. Nobody else reads accounts, price books, usage or invoices.
4. **Store facts, derive state.** Store trial end, invoices, payments and suspension. Derive "trial / active / overdue / restricted / suspended" from them with one pure function. No status column for a job to keep up to date.
5. **Metering is recorded by the database, not remembered by developers.** Head counts are captured by triggers on the tables that define them, so no new code path can forget to meter.
6. **Invoices are immutable snapshots.** An invoice stores quantities and unit prices as they were. Later price changes never change a past bill. Corrections are credit notes or adjustment lines, never edits.
7. **Never block what exists.** Restrictions refuse *new* billable heads only. Viewing, scanning, attendance, fee collection and invoices keep working unless an admin suspends the account.
8. **Enforce on the server, explain on the client.**
9. **Every platform change is audited in the same transaction.**
10. **The platform sees metadata, not people.** The console shows counts, prices and money, not student names or phones.
11. **Expand, then contract.** Old columns are dropped only after the code reading them is gone.

---

## 5. Domain model

### 5.1 Concepts

| Concept | Definition |
|---|---|
| **Account** | A paying customer: owner, price book, trial end, suspension, notes. Owns 1..n institutes. |
| **Price book** | A named set of values: unit prices per head, free allowances, minimum monthly charge, feature switches and optional caps. Books: `standard` (default for new customers) plus any the admin creates (e.g. `ngo`, `pilot`). |
| **Override** | A per-account value for one key, optionally expiring, with a note. Wins over the price book. This is how one customer gets students at LKR 80. |
| **Billable head** | `student`, `teacher`, `parent`. Admin and receptionist are also catalogued, at LKR 0 by default ([§14](#14-decisions-made-2026-10-17)). |
| **Usage record** | The count of one head type in one institute on one day (max and last value). Written by triggers. |
| **Subscription invoice** | One per account per month: lines of head × peak quantity × unit price, minus free allowance, plus minimum-charge top-up. Status `open` / `paid` / `void`. |
| **Subscription payment** | A bank transfer recorded against an invoice. |
| **Platform admin** | A user with `users.is_platform_admin = true`. Grants no institute powers. |
| **Audit event** | Who changed what on which account, before and after, and when. |

Subscription invoices are separate from the institute's own **fee invoices to students** (`invoices` table, migration 007). They live in different tables and modules and never mix.

### 5.2 Account state, derived (pure function)

Given the account, its unpaid invoices, settings and `now`, the first matching rule wins:

| # | Condition | State | New billable heads | Banner |
|---|---|---|---|---|
| 1 | `suspended_at` set | `suspended` | No. **All writes blocked** (read-only) | Red, contact support |
| 2 | `trial_ends_at > now` | `trial` | Yes, within trial caps | Blue, days left |
| 3 | An open invoice is past `due_date + grace_days` | `restricted` | **No.** Everything else works | Red, pay to add more |
| 4 | An open invoice is past `due_date` | `overdue` | Yes | Amber, amount due |
| 5 | otherwise | `active` | Yes | None |

`resolveAccountState(account, openInvoices, settings, now)` is pure, with no stored status. Recording a payment moves the account straight back to `active`.

### 5.3 Catalogue (v1)

| Key | Kind | Meaning | Default (`standard`) |
|---|---|---|---|
| `price.student` | price (LKR / head / month) | active `students` rows | 100 |
| `price.teacher` | price | active members with role `teacher` | 2,000 |
| `price.parent` | price | active members with role `parent` (portal users) | 50 |
| `price.admin` | price | active members with role `admin` | 0 |
| `price.receptionist` | price | active members with role `receptionist` | 0 |
| `included.student` | free allowance per month | first N students not charged | 0 |
| `included.teacher` / `.parent` / … | free allowance | same per head | 0 |
| `minimum.monthly` | LKR | invoice is at least this (if > 0) | 0 |
| `cap.students` / `cap.teachers` / `cap.parents` / `cap.institutes` | optional cap (null = none) | refuse new heads beyond this | null, institutes 3 |
| `feature.bank_slips` | toggle | slip upload and review | on |
| `feature.live_links` | toggle | class live links | on |
| `feature.reports` | toggle | reports and CSV | on |
| `feature.student_import` | toggle | CSV student import | on |
| `feature.portal` | toggle | parent/student app | on |

**Trial caps are overrides, not a price book.** A new self-service account gets `account_overrides` for `cap.students = 100`, `cap.teachers = 5`, `cap.institutes = 1` (from the `trial_caps` setting) that expire with the trial. Trial days are never billed (§6.2), so no zero-price book is needed. Existing institutes moved to accounts get the free period **without** caps, so nobody's current work is blocked. *(Changed during Phase 1; the earlier draft used a separate `trial` price book.)*

All values in this table are **seeded starting values**. The super admin edits them in the console, creates new price books, and overrides any value for one customer (§10.2).

Student and owner logins are never billed: students are billed as records (`students` rows), not as app logins.

Platform settings: `trial_days = 30`, `grace_days = 7`, `invoice_due_days = 7`, support WhatsApp number, bank details.

---

## 6. Pricing and metering

### 6.1 Monthly cycle

```
calendar month (Asia/Colombo)  ── heads are metered all month by triggers
1st of next month              ── admin clicks "Generate invoices for <month>"  (idempotent)
                                  invoice per account = Σ lines, due in 7 days
customer                       ── sees invoice in Billing page, pays by bank transfer,
                                  sends slip on WhatsApp (button with amount + reference)
admin                          ── records payment against the invoice → state back to active
due + 7 days unpaid            ── restricted: no new students/teachers/parents
admin (optional)               ── suspend: read-only
```

Generating invoices is idempotent (`UNIQUE (account_id, period)`), so clicking twice does nothing. When the worker from ADR 001 exists, a scheduled run calls the same function ([§12](#12-how-to-extend-it-later)).

### 6.2 Invoice calculation (pure, unit-tested)

For account *A*, month *M*, and each billable head *h*:

```
peak(h)      = max over days d in M (excluding trial days) of  Σ over A's institutes of count(h, institute, d)
billable(h)  = max(0, peak(h) − included(h))
line(h)      = billable(h) × price(h)
total        = max(Σ line(h), minimum.monthly)        -- top-up shown as its own line
```

- **Trial overlap:** days on or before `trial_ends_at` are excluded. A trial that ends on the 12th bills the peak from the 13th onward.
- **Mid-month price change:** prices are read when the invoice is generated, and each line stores its unit price.
- **Customers mid-month:** a new account bills from its first day, with no proration (peak rule).
- `computeInvoice(dailyCounts, values, trialEndsAt, month)` is a pure function. Most billing tests target it.

### 6.3 Metering: how head counts are recorded

A **statement-level `AFTER` trigger** (one per insert/update/delete) on each table that defines a head records the institute's new count for today:

| Table | Head(s) affected |
|---|---|
| `students` (status change, insert, delete) | `student` |
| `membership_roles` (insert, delete) | `teacher`, `parent`, `admin`, `receptionist` |
| `tenant_memberships` (status change) | all member heads |

The trigger:
1. Collects the affected `tenant_id`s from the statement's transition tables.
2. Counts the current total for the affected head(s) in each tenant. This is one indexed `COUNT`. It runs in the writer's RLS context, which is always that tenant, because RLS `WITH CHECK` already requires it.
3. Upserts `tenant_usage_daily(tenant_id, day, head)` with `count_max = GREATEST(count_max, n)` and `count_last = n`.

Properties:

- **Can't be forgotten.** Any future code path that adds students or members is metered automatically. That covers the console, an API route, CSV import and the portal.
- **Statement level.** A CSV import of 300 students causes one count, not 300.
- **Days with no change** have no row. The count on such a day is the latest `count_last` before it, so the invoice query carries values forward. It also reads the last row before the month to get the opening count.
- **Per institute, with RLS.** `tenant_usage_daily` has `tenant_id`, so it gets forced RLS like every tenant table (the isolation test in `packages/db` enforces this). Invoicing and the console read it per institute with `forEachTenant`. *(Changed during Phase 1; the earlier draft made it a global table.)*
- **Backfill:** migration 013 writes today's counts for every institute, so the first month has an opening value.

### 6.4 Customer-facing estimate

The Billing page (owner and admin roles) shows this month **so far**:

- the peak per head and its price;
- the running total;
- last month's invoice and its status;
- how to pay (bank details, reference = invoice number, WhatsApp button to send the slip).

It uses the same `computeInvoice` function, with "month so far" as input, so the estimate and the bill can't disagree.

---

## 7. Entitlements engine

### 7.1 Flow of one check

```
billing.assertCanAddHead(trx, req.tenant, 'student', +1)
   1. account for req.tenant.accountId (global)
   2. state = resolveAccountState(account, openInvoices, settings, now)   (pure)
   3. suspended → 403 account_suspended;  restricted → 403 account_restricted
   4. values = merge(priceBook, active overrides)                         (pure)
   5. cap = values['cap.students']; null → allow
   6. pg_advisory_xact_lock(hash('cap:student:' || accountId))
   7. used = Σ live counts across the account's institutes (§7.4)
   8. used + adding > cap → 403 plan_limit { key, limit, used }
```

Feature checks are steps 1–4 plus a lookup, with no counting and no lock.

### 7.2 Pure functions (where most tests go)

```ts
// modules/billing/resolve.ts — no I/O
resolveAccountState(account, openInvoices, settings, now) → { state, writable, canAddHeads, daysLeft }
resolveValues(priceBook, overrides, now)                   → typed values for every catalogue key
// modules/billing/invoice.ts — no I/O
computeInvoice(dailyCounts, values, trialEndsAt, period)   → { lines, total }
```

### 7.3 Enforcement points

| Mechanism | Where | Used for |
|---|---|---|
| Declarative feature gate | Route option `config: { feature: 'reports' }`, checked by `plugins/entitlements.ts` after `loadTenant` (type-checked key) | reports, import, slips, live-link routes, portal invites |
| `assertCanAddHead` | inside the write transaction | student create, restore and import; staff invite create and accept (teacher/admin/receptionist); parent portal invite accept; institute create |
| Write-block | same plugin: suspended + non-GET → `403 account_suspended` | everything under `/tenants/:tenantId` |
| Response shaping | portal omits `liveUrl` when `feature.live_links` is off | family view |

Exact call sites:

| Head | File | Event |
|---|---|---|
| student | `students/routes.ts` POST `/`, PATCH inactive→active; `students/import.ts` | replaces `assertStudentCapacity` |
| teacher / admin / receptionist | `staff/routes.ts` POST `/invites`, POST `/invites/:code/accept` (staff roles) | new |
| parent | `staff/routes.ts` POST `/invites/:code/accept` (role parent) | new. Creating the invite stays free; accepting adds the head |
| institute | `tenancy/routes.ts` POST `/` | new; also attaches the tenant to the account |

**Restricted accounts must still be able to collect fees** (that's how they earn the money to pay us). The block applies only to adding heads.

### 7.4 Counting across institutes under RLS

The live count for a cap check uses a small helper that runs a count under each of the account's institutes in turn, inside the caller's transaction, and restores the original context in `finally`:

```ts
// packages/db/src/context.ts
export async function forEachTenant<T>(trx, tenantIds, userId, fn: (tenantId) => Promise<T>): Promise<T[]>
```

- Tenant ids come from `tenants.account_id` (global), never from the request.
- An account has a handful of institutes, so the cost is a few indexed counts.
- A `SECURITY DEFINER` function was rejected: with forced RLS its owner would need `BYPASSRLS`, which goes against ADR 002.
- Invoicing and the console use the same helper to read `tenant_usage_daily` per institute.

### 7.5 Concurrency

- One advisory lock per account and head (`cap:<head>:<accountId>`) in the write transaction.
- Invoice generation locks per account (`invoice:<accountId>`) and relies on `UNIQUE (account_id, period)`.
- Payments use `client_ref UNIQUE`, as fee payments already do.

### 7.6 API contract

```jsonc
// GET /api/v1/tenants/:tenantId  (existing; replaces the old `usage` field)
{
  "tenant": { … }, "roles": ["owner"],
  "entitlements": {
    "state": "trial",               // trial | active | overdue | restricted | suspended
    "trialEndsAt": "…", "daysLeft": 30, "writable": true, "canAddHeads": true,
    "features": { "reports": true, "bank_slips": true, "live_links": true, "student_import": true, "portal": true },
    "caps":     { "students": { "limit": 100, "used": 12 }, … }          // owners/admins only
  }
}

// GET /api/v1/tenants/:tenantId/billing   (owner, admin)
{
  "prices": { "student": 100, "teacher": 2000, "parent": 50, … },
  "thisMonth": { "lines": [ { "head": "student", "peak": 120, "included": 0, "unitPrice": 100, "amount": "12000.00" }, … ], "total": "22000.00" },
  "invoices": [ { "number": "S-2026-10-0007", "period": "2026-09", "total": "21500.00", "status": "open", "dueDate": "2026-10-08" } ],
  "payTo": { "bank": "…", "account": "…", "whatsapp": "94…" }
}
```

Errors use the existing `{ code, message, requestId, details }` shape:

- `403 plan_limit { key, limit, used }` (existing code, more detail);
- `403 feature_locked { feature }`;
- `403 account_restricted { amountDue, invoiceNumber }`;
- `403 account_suspended`.

---

## 8. Data model and migrations

### 8.1 New and changed tables

All of these are global (no RLS), like `tenants` and `users`, except `tenant_usage_daily`, which has `tenant_id` and therefore forced RLS. They hold counts and money, never student details.

```sql
price_books (
  key varchar(32) PRIMARY KEY,                 -- standard | trial | <custom>
  name varchar(100) NOT NULL,
  values jsonb NOT NULL,                       -- { "price.student": 100, "cap.students": null, "feature.reports": true, … }
  is_default boolean NOT NULL DEFAULT false,   -- exactly one (partial unique index)
  updated_at timestamptz NOT NULL DEFAULT now()
)

platform_settings (key varchar(64) PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())

accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  owner_user_id uuid REFERENCES users(id),     -- null until the invited owner signs up
  owner_phone varchar(15) NOT NULL,            -- digits, like users.phone; used to claim
  price_book varchar(32) NOT NULL REFERENCES price_books(key),
  trial_ends_at timestamptz,
  suspended_at timestamptz, suspended_reason varchar(300),
  notes text,
  created_by uuid REFERENCES users(id),        -- null = self sign-up
  created_at, updated_at
)  UNIQUE (owner_user_id) WHERE owner_user_id IS NOT NULL;  INDEX (owner_phone)

account_overrides (
  account_id uuid REFERENCES accounts ON DELETE CASCADE, key varchar(64),
  value jsonb NOT NULL, expires_at timestamptz, note varchar(300) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
)

tenant_usage_daily (                            -- written only by triggers; forced RLS (has tenant_id)
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  day date NOT NULL,                            -- Asia/Colombo date
  head varchar(16) NOT NULL,                    -- student | teacher | parent | admin | receptionist
  count_max integer NOT NULL, count_last integer NOT NULL,
  PRIMARY KEY (tenant_id, head, day)
)

subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts,
  number varchar(32) NOT NULL UNIQUE,           -- S-2026-10-0007
  period char(7) NOT NULL,                      -- YYYY-MM billed
  lines jsonb NOT NULL,                         -- snapshot: head, peak, included, unit_price, amount
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  due_date date NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  generated_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period)
)

subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES subscription_invoices,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method varchar(16) NOT NULL DEFAULT 'bank_transfer',   -- later: payhere
  reference varchar(100),
  client_ref uuid NOT NULL UNIQUE,
  recorded_by uuid REFERENCES users(id),                 -- null = provider webhook (later)
  received_at timestamptz NOT NULL DEFAULT now()
)

platform_audit (
  id bigserial PRIMARY KEY, actor_user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid REFERENCES accounts(id), action varchar(64) NOT NULL,
  before jsonb, after jsonb, ip varchar(45), created_at timestamptz NOT NULL DEFAULT now()
)  INDEX (account_id, created_at DESC)

tenants  + account_id uuid REFERENCES accounts(id)   -- NOT NULL after backfill; INDEX
users    + is_platform_admin boolean NOT NULL DEFAULT false
```

Notes:

- `price_books.values` and override values are validated by Zod against the code catalogue on write. The resolver treats a missing key as its safe default (price 0, feature off, cap 0 for caps that are set), so keys can be added in either order.
- An invoice is `paid` when its payments sum to its total. Part payments are allowed.
- `platform_audit` and `subscription_invoices` lines are append-only: the app role gets no `UPDATE`/`DELETE` on audit, and voiding an invoice is a status change plus an audit row.
- The trigger function is `SECURITY INVOKER` and only writes `tenant_usage_daily`, so it needs no extra privilege.

### 8.2 Migrations

| # | Name | Contents | Safe with old code? |
|---|---|---|---|
| 013 | `accounts_and_billing` | All tables above; seed the `standard` price book and settings; `tenants.account_id`; `users.is_platform_admin`; backfill accounts; `SET NOT NULL`; audit grants | Yes |
| 014 | `usage_metering` | Trigger function + triggers; backfill today's counts into `tenant_usage_daily` | Yes: only adds a side effect on writes |
| 015 | `drop_tenant_plan` | Drop `tenants.plan`, `plan_expires_at` and constraints | Only after phase 1 has been live ≥ 1 release |

**Backfill rules (013):**

1. Owners are read per tenant with `app.tenant_id` set, because RLS is forced and the production owner role may not bypass it.
2. One account per owner user; an owner of several institutes gets one account holding all of them.
3. **Existing customers** start on `standard` with `trial_ends_at` = the later of their current `plan_expires_at` and *migration date + 30 days*. Nobody is billed for time they already paid for, and everyone gets at least a month's notice ([§14 decision 6](#14-decisions-made-2026-10-17)).
4. A tenant with no active owner (not expected) gets its own account with `owner_user_id = null`, and the migration logs it.
5. `down()` drops everything added. `tenants.plan` is untouched until 015, so rollback is lossless. CI `migrate check` covers it.

---

## 9. Code layout

### 9.1 API

```
apps/api/src/
  modules/
    billing/                     NEW — the only module touching accounts, price books, usage, subscription invoices
      catalogue.ts               heads, features, caps, price keys; Zod schema for values
      resolve.ts                 pure: resolveAccountState, resolveValues
      invoice.ts                 pure: computeInvoice
      usage.ts                   live counts (forEachTenant) + daily series from tenant_usage_daily
      service.ts                 getEntitlements, assertFeature, assertCanAddHead,
                                 findOrClaimOrCreateAccount, generateInvoices(period),
                                 recordPayment, voidInvoice, extendTrial, setOverride,
                                 clearOverride, suspend, unsuspend, updatePriceBook, updateSettings
                                 (every mutation writes platform_audit in the same trx)
      routes.ts                  customer: GET /tenants/:id/billing
      index.ts                   public surface for other modules
    platform/                    NEW — super admin API, /api/v1/admin/*
      routes.ts
  plugins/
    entitlements.ts              NEW — feature gate (route config) + suspension write-block + req.entitlements() memo
    platform-admin.ts            NEW — requirePlatformAdmin (404 for everyone else), fresh-session check
  lib/plans.ts                   DELETED in phase 1
packages/db/
  src/context.ts                 + forEachTenant
  migrations/013_accounts_and_billing.ts, 014_usage_metering.ts, 015_drop_tenant_plan.ts
```

Dependency rule: feature modules import only `modules/billing/index.ts`. `platform` calls `billing/service.ts` for every change, so the console, a future PayHere webhook and a future scheduled job all share one code path and one audit trail.

### 9.2 Web

```
apps/web/src/
  lib/entitlements.ts            types mirroring the API
  lib/nav.ts                     NavItem gains `feature?`; new "Billing" item (owner, admin)
  components/
    dashboard-shell.tsx          TenantData gains `entitlements`; renders <AccountBanner/>; lock icons on locked menu items
    account-banner.tsx           trial / overdue / restricted / suspended
    locked.tsx                   <Locked feature> card for gated pages
    billing/billing-page.tsx     this month estimate, invoices, how to pay, WhatsApp slip button
    settings/plan-card.tsx       replaced by a link to Billing
    admin/*                      admin shell + screens (§10.4)
  app/[lang]/t/[tenantId]/billing/page.tsx
  app/[lang]/admin/**            accounts, accounts/new, accounts/[id], invoices, price-books, settings, audit
  i18n/dictionaries/{si,ta,en}.ts  billing.*, admin.*, new error codes
```

---

## 10. Super admin console

### 10.1 Security model

| Concern | Decision |
|---|---|
| Who | `users.is_platform_admin`. The first admin is set by SQL on the server (runbook). Adding more admins in the console waits for 2FA ([§14](#14-decisions-made-2026-10-17)). |
| Hiding | Every `/api/v1/admin/*` route returns **404** for non-admins. |
| Sessions | Admin routes need a session younger than 12 h. Stricter rate limit on mutations. |
| Data access | Accounts, institutes (names only), owner phone, counts, prices and money. Never students, guardians, attendance or fee records. |
| Audit | Every mutation writes `platform_audit` with before/after, in the same transaction. |

### 10.2 API (`/api/v1/admin`)

| Method + path | Does |
|---|---|
| `GET /accounts?q=&state=` | List: name, owner, state, heads this month, estimated bill, amount due |
| `POST /accounts` | Create for `{ name, ownerName, ownerPhone, priceBook, trialDays }` → WhatsApp sign-up message link |
| `GET /accounts/:id` | Detail: state, values (book + overrides), usage chart, institutes, invoices, payments, audit |
| `PATCH /accounts/:id` | Name, notes, price book |
| `PUT /accounts/:id/overrides/:key` · `DELETE` | Customer price/cap/feature `{ value, expiresAt?, note }` |
| `POST /accounts/:id/trial` | `{ days }` extend or start |
| `POST /accounts/:id/suspend` · `/unsuspend` | `{ reason }` |
| `POST /invoices/generate` | `{ period }` → generate for every account (idempotent); returns counts |
| `GET /invoices?period=&status=` | All subscription invoices |
| `POST /invoices/:id/payments` | `{ amount, reference, clientRef }` |
| `POST /invoices/:id/void` | `{ reason }` (then regenerate if needed) |
| `GET /price-books` · `PUT /price-books/:key` · `POST /price-books` | Edit or add books (validated; shows affected accounts) |
| `GET /settings` · `PUT /settings/:key` | Trial days, grace days, due days, bank details, support WhatsApp |
| `GET /audit?accountId=&actor=` | Audit log |

### 10.3 Account claiming

1. The admin creates an account with `owner_phone` and sends the WhatsApp sign-up message from the console.
2. The customer signs up, or logs in, with that phone and creates an institute.
3. `findOrClaimOrCreateAccount(user)`:
   1. Uses the account the user already owns.
   2. Otherwise claims an unclaimed account whose `owner_phone` matches.
   3. Otherwise creates a self-service account on the default price book with a trial.

This is the same phone-match trust as staff invites, with no new token type.

### 10.4 Screens

| Screen | Content |
|---|---|
| Accounts | Table with filters: *Trial ending in 7 days*, *Overdue*, *Restricted*, *Suspended*. Row: heads now, estimate, due. WhatsApp reminder button (owner's language). |
| Account detail | State and dates; values with overrides highlighted; heads per day (simple bar list); institutes; invoices with **Record payment**; **Extend trial**, **Suspend**; overrides editor; audit history |
| New account | Name, owner name and phone, price book, trial days |
| Invoices | Month picker, **Generate for month**, list with status, totals, export CSV |
| Price books | Grid: books × keys (prices, allowances, minimum, caps, features). Save shows "affects N accounts" |
| Settings | Trial, grace and due days; bank details; support WhatsApp |
| Audit | Filterable log |

---

## 11. Implementation phases

Each phase is its own release to `production` and must pass format, lint, typecheck, all tests and `migrate check`.

### Phase 0: Decide (no code)

- Answer [§14](#14-decisions-made-2026-10-17).
- Write `docs/adr/009-per-head-pricing.md` superseding ADR 008's flat pricing.
- Update the pricing section of the landing page copy.

### Phase 1: Accounts and the engine (no visible change)

| # | Task | Files |
|---|---|---|
| 1.1 | Migration 013 (tables, seed, backfill, grants) | `packages/db/migrations/013_accounts_and_billing.ts` |
| 1.2 | `forEachTenant` + test that context is restored, including after an error | `packages/db/src/context.ts`, `packages/db/test/` |
| 1.3 | Catalogue + Zod schemas | `billing/catalogue.ts` |
| 1.4 | Pure `resolveAccountState`, `resolveValues` + unit tests (every row of §5.2, override expiry, precedence) | `billing/resolve.ts`, `test/billing-resolve.test.ts` |
| 1.5 | `getEntitlements`, `assertCanAddHead('student')`; replace `assertStudentCapacity`/`planUsage`; delete `lib/plans.ts` | `billing/*`, `students/*`, `tenancy/routes.ts` |
| 1.6 | `POST /tenants` → find/claim/create account | `tenancy/routes.ts`, `billing/service.ts` |
| 1.7 | `GET /tenants/:id` returns `entitlements` (replaces `usage`; only the plan card read it, and both ship together) | `tenancy/routes.ts` |
| 1.8 | Port `plans.test.ts`; tests: backfilled accounts, account-wide cap across two institutes, two-desk race | `apps/api/test/` |

**Done when:**
- All existing tests pass.
- Existing institutes behave as before.
- `migrate check` passes.

### Phase 2: Metering and invoices (admin-side, via API and runbook)

| # | Task | Files |
|---|---|---|
| 2.1 | Migration 014: trigger function + triggers + today's backfill | `014_usage_metering.ts` |
| 2.2 | Pure `computeInvoice` + unit tests: peak across institutes, carry-forward days, opening value, trial-day exclusion, allowances, minimum charge, rounding to cents | `billing/invoice.ts`, `test/billing-invoice.test.ts` |
| 2.3 | `generateInvoices(period)`, `recordPayment`, `voidInvoice` with audit | `billing/service.ts` |
| 2.4 | Tests: trigger fires on insert/status change/delete/import (one row per statement); membership role add/remove; parent accept counted, invite not; regenerate is a no-op; payment idempotent | `apps/api/test/metering.test.ts` |
| 2.5 | Runbook: generate invoices + record payment via a temporary admin script until phase 3 | `docs/runbooks/billing.md` |

**Done when:** a seeded month with heads changing across two institutes produces the expected invoice to the cent.

### Phase 3: Super admin console

| # | Task | Files |
|---|---|---|
| 3.1 | `requirePlatformAdmin` (404), fresh session, rate limit | `plugins/platform-admin.ts` |
| 3.2 | Admin API (§10.2) | `modules/platform/routes.ts` |
| 3.3 | `/auth/me` returns `isPlatformAdmin`; header link for admins | `identity/routes.ts`, shell |
| 3.4 | Console screens (§10.4) | `app/[lang]/admin/**`, `components/admin/**` |
| 3.5 | Account claiming by phone | `billing/service.ts` |
| 3.6 | Tests: non-admin 404 everywhere; one audit row per mutation; overrides change the next invoice but never past ones; price book edit rejects unknown keys | `apps/api/test/platform.test.ts` |
| 3.7 | Runbooks rewritten for the console; SQL only for the first admin | `docs/runbooks/` |

### Phase 4: Customer billing, trial, restrictions and feature gates

| # | Task | Files |
|---|---|---|
| 4.1 | `plugins/entitlements.ts`: feature gate, suspension write-block, restricted-state head block | plugin, `app.ts` |
| 4.2 | Gate routes (reports, import, slips, live links, portal invites); caps on teachers, parents and institutes | module routes |
| 4.3 | ~~New self-service accounts get a trial~~ done in Phase 1 (`accountForNewInstitute`) | `billing/service.ts` |
| 4.4 | Billing page: estimate, invoices, pay instructions, WhatsApp slip button | `billing/routes.ts`, web `billing/*` |
| 4.5 | Account banner (trial / overdue / restricted / suspended); lock icons; `<Locked>`; dictionaries | web |
| 4.6 | Tests: trial caps; trial end starts billing; overdue → restricted after grace blocks only new heads; fee collection still works when restricted; suspended GET ok / POST 403; family never blocked except suspension | `apps/api/test/entitlements.test.ts` |

**Done when:**
- A new sign-up has 30 free days with a countdown.
- The first invoice bills only post-trial days.
- An unpaid account can still collect student fees but cannot add students.

### Phase 5: Contract and harden

- Migration 015 (drop old plan columns).
- Update [UI_UX.md](UI_UX.md), [RELEASE_V1.md](RELEASE_V1.md) and the landing page.
- Load check: 300 seeded accounts, console list under 1 s, invoice generation under 10 s.

### Effort (rough, one developer)

| Phase | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Days | ½ | 3–4 | 3–4 | 4–5 | 4 | ½ |

---

## 12. How to extend it later

| Future need | How it fits |
|---|---|
| **New billable head** (e.g. receptionist at a price, SMS sender) | Catalogue key + trigger on its table (if a new table) + price in books. Invoices pick it up automatically. |
| **Prorated billing** instead of peak | `computeInvoice` uses Σ daily counts / days in month. `tenant_usage_daily` already has daily values. No schema change. |
| **Per-institute pricing or caps** | Key gets `scope: 'institute'`; `usage.ts` counts the current tenant only. |
| **New feature toggle** | Catalogue key + book values + `config: { feature }` on routes + `feature` on its menu item. |
| **Card payments (PayHere)** | Webhook → verify → `billing.recordPayment({ method: 'payhere', recordedBy: null })`, the same function the console uses. |
| **Automatic invoice generation / reminders** | Worker (ADR 001) calls `generateInvoices` on the 1st and sends reminders with `resolveAccountState`. |
| **WhatsApp / SMS credits (metered)** | A `usage_events` ledger + `metered` kind in the catalogue; lines appear on the same invoice. |
| **Discounts / promos** | Overrides with `expires_at` ("students at 80 until March"), or an `adjustments` line type on invoices. |
| **Annual prepay** | Payment creates a credit balance applied by `generateInvoices`: an `account_credits` ledger. |
| **Several people managing one account** | `account_members (account_id, user_id, role)` replaces `owner_user_id`. |
| **Very many accounts** | Console reads `tenant_usage_daily` already (no per-tenant queries). Add a monthly rollup table if needed. |
| **Impersonation** | `platform_impersonations` (time-boxed, reason) + read-only session flag + customer notice + audit. |
| **Dedicated database for a big customer** | Accounts are global; institutes stay isolated by `tenant_id`, as ADR 002 anticipates. |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Price shock vs research.** ADR 008 found buyers dislike per-student pricing, and competitors charge LKR 2,000–15,000/month. At default prices, 120 students + 3 teachers + 80 parents = LKR 22,000/month | All prices are data. Consider free allowances (e.g. first 30 students), parents at 0, or a minimum + lower per-head. Test with pilot users before publishing. The estimate on the Billing page avoids surprises. |
| Customers deactivate students to save money | Peak billing: deactivating mid-month doesn't lower that month's bill. |
| Trigger performance on bulk writes | Statement-level triggers with one indexed count per statement. Covered by a CSV-import test with 500 rows. |
| Trigger misses a path (e.g. a status change done by raw SQL) | The trigger is on the table itself, so every path is covered. A test asserts the count after each mutation type. A console "recount" action rewrites today's row from live counts. |
| Backfill under forced RLS reads nothing in production | Per-tenant `app.tenant_id` in the migration. Rehearse against a non-`BYPASSRLS` owner role locally. Abort if any tenant has no account. |
| `forEachTenant` leaks context | Restores in `finally`; dedicated test. |
| Wrong price book edit bills everyone wrongly | Zod validation, "affects N accounts" confirmation, audit holds the before value. Invoices are generated by a person who sees totals before sending, and voiding plus regenerating is supported. |
| Old web build against new API during deploy | New error codes fall back to the generic message; the plan card fails quietly (renders nothing) until the page reloads. |
| Trial abuse with new phone numbers | Trial caps; console shows accounts per phone/name; admin can suspend. |
| Platform admin takeover | Few admins, fresh-session rule, audit, 2FA before a second admin, no student data in the console. |

---

## 14. Decisions (made 2026-10-17)

Recorded in [ADR 009](adr/009-per-head-pricing.md).

| # | Question | Decision |
|---|---|---|
| 1 | Prices per head | **Set by the super admin**, globally (price books, which the admin can create) or per customer (overrides). Seeded starting values: student 100, teacher 2,000, parent 50 (LKR/month) |
| 2 | Are admins and receptionists billed? | **Super admin decides.** Each role has its own price key; seeded at 0 |
| 3 | Free allowance or minimum charge? | **Super admin creates them as needed,** per price book or per customer (`included.*`, `minimum.monthly`, optionally expiring). Seeded at none |
| 4 | Counting method | **Peak per calendar month** |
| 5 | Trial length and caps | **30 days**, capped at 100 students, 5 teachers, 1 institute (trial price book; admin can change or extend) |
| 6 | Existing customers | **At least 30 days free** before the first per-head bill (or until their current paid date, if later) |
| 7 | Unpaid after due + 7 days | **No new heads**: everything else works, including fee collection. Suspension (read-only) is a manual admin action |
| 8 | Who is super admin | **Only the platform owner, set by SQL**, until 2FA exists |
| 9 | Institutes per account | **Up to 3** by default, editable per customer |
| 10 | Portal (parent/student app) | **On for every customer** by default, can be switched off per customer |
| 11 | Bank details and support WhatsApp | **Entered later in the console's Settings page**, before the first invoice is generated |

What these answers change in the design: nothing structural. They confirm that every price, allowance, minimum and cap is data the super admin edits (§5.3, §10.2 price books and overrides), with seeded starting values only.

---

## Sources

- [Ordway: high-water mark billing](https://ordwaylabs.com/blog/high-water-mark-billing/)
- [Bunny: pricing by number of users](https://docs.bunny.com/guide/best-practices/pricing-by-number-of-users)
- [Atlassian: maximum quantity billing](https://www.atlassian.com/blog/company-news/maximum-quantity-billing)
- [Cal.com: seat billing](https://cal.com/help/billing-and-usage/seat-billing)
- [Slack: fair billing policy](https://slack.com/help/articles/218915077-Slack-s-fair-billing-policy)
- [Schematic: the entitlements layer](https://schematichq.com/blog/the-entitlements-layer-how-saas-products-control-customer-access)
- [Lago: SaaS entitlements](https://www.getlago.com/blog/saas-entitlements)
- [Dodo Payments: entitlement management for SaaS](https://dodopayments.com/blogs/entitlement-management-saas/)
- [GoCardless: SaaS free trials](https://gocardless.com/guides/posts/saas-free-trials)
- [Visionary Marketing: SaaS trial benchmark 2026](https://visionary-marketing.co.uk/blog/saas-free-trial-conversion-statistics-2026)
- [Flint: B2B SaaS trial conversion statistics](https://www.flint.com/blog/b2b-saas-free-trial-conversion-rate-statistics)
- [Insivia: improving trial conversion](https://www.insivia.com/how-to-improve-saas-free-trial-conversion-rates/)
- [Servala: trials and expiry](https://docs.servala.com/concepts/trials/)
- [GitLab: plan reversion after trial](https://gitlab.com/gitlab-org/gitlab/-/issues/12186)
- [Booknetic: automated trial management](https://www.booknetic.com/feature/automated-trial-management)
- [OpenMeter: grace period](https://openmeter.io/docs/glossary/grace-period)
- [NHI: delegated administration in multi-tenant SaaS](https://nhimg.org/faq/how-should-security-teams-govern-delegated-administration-in-multi-tenant-saas/)
- [SaaS admin back-office tooling](https://www.skills.sh/peterbamuhigire/skills-web-dev/saas-admin-backoffice-tooling)
- [ABP: tenant impersonation permissions](https://abp.io/support/questions/10525/Tenant-Impersonation-By-User)
