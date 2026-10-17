# SaaS Task List: accounts, per-head billing, trials, super admin

Based on [SAAS_PLAN.md](SAAS_PLAN.md) (§ numbers below point there). Mark `[x]` when done.

**Legend:** `[x]` completed · `[ ]` not completed · `[~]` in progress

**Progress:** Phase 0: 5/6 · Phase 1: 23/24 · Phase 2: 0/18 · Phase 3: 1/29 · Phase 4: 2/19 · Phase 5: 0/8

**Rules for every phase**

- One phase = one or more PRs to `main`, then one release to `production` (`git checkout production && git merge --ff-only main && git push`).
- A phase is done only when CI is green: format, lint, typecheck, all tests, `npm run migrate -- check`.
- Migrations are expand-only until Phase 5. Never edit a migration that has reached production.
- Other modules call only `apps/api/src/modules/billing/index.ts` (SAAS_PLAN §4 rule 3).
- Every new UI string goes into `si`, `ta` and `en`.

---

## Phase 0: Decide (no code)

- [x] Answer the decisions in SAAS_PLAN §14 and write the answers into §14 (11 decisions, 2026-10-17)
- [x] Update default values in SAAS_PLAN §5.3 (seeded values, admin-editable; trial caps 100 students / 5 teachers / 1 institute)
- [x] Write `docs/adr/009-per-head-pricing.md` (supersedes ADR 008 flat pricing); mark ADR 008 "Superseded by 009"
- [ ] Check prices with at least 2 pilot teachers before publishing them (SAAS_PLAN §13, first risk). **Owner's task; doesn't block Phase 1–3**, must be done before Phase 4 shows prices to customers
- [x] Decide the bank account and support WhatsApp number shown on the Billing page: entered later in the console Settings page (task added to Phase 3 release)
- [x] Decide who is super admin: only the platform owner, granted by SQL in the Phase 3 release; console grants wait for 2FA

---

## Phase 1: Accounts and the engine (no visible change)

Goal: accounts exist, the student cap runs through `billing`, existing institutes behave exactly as before. SAAS_PLAN §8, §7.1–7.5.

**Status:** built and committed to `main` 2026-10-17 (`7d31f24`); not yet released to production.

### Database
- [x] Migration `013_accounts_and_billing`: tables `price_books`, `platform_settings`, `accounts`, `account_overrides`, `subscription_invoices`, `subscription_payments`, `platform_audit` (SAAS_PLAN §8.1)
- [x] 013: `tenants.account_id` (nullable + index), `users.is_platform_admin` (default false)
- [x] 013: seed price book `standard` (default) and settings `trial_days`, `grace_days`, `invoice_due_days`, `trial_caps`, `support_whatsapp`, `bank_details` (trial caps are expiring overrides, not a `trial` book; see SAAS_PLAN §5.3)
- [x] 013: backfill (per-tenant `app.tenant_id` to read owners under forced RLS; one account per owner; existing customers get `trial_ends_at = max(plan_expires_at, now + 30 days)`; tenants without owner logged), then `SET NOT NULL` on `tenants.account_id`
- [x] 013: grants: app role `INSERT, SELECT` only on `platform_audit`; `down()` drops everything added
- [x] Rehearse 013 locally with an owner role that is **not** `BYPASSRLS` (copy of local dev data: 3 owners found, all claimed) and with seeded edge cases on the test DB (owner of 2 institutes → 1 account, paid plan keeps its paid date, institute without owner → unclaimed account + warning)
- [x] `forEachTenant(trx, tenantIds, fn)` in `packages/db/src/context.ts` (keeps the caller's user context), exported from `packages/db/src/index.ts`
- [x] Test: `forEachTenant` restores the original context after success and after a thrown error (`packages/db/test/`)

### Billing module (API)
- [x] `modules/billing/catalogue.ts`: head, price, included, minimum, cap and feature keys; Zod schema for price book values and override values
- [x] `modules/billing/resolve.ts`: pure `resolveAccountState(account, openInvoices, settings, now)` and `resolveValues(priceBook, overrides, now)`
- [x] Unit tests `test/billing-resolve.test.ts`: every row of SAAS_PLAN §5.2, first-match order, override precedence, expired override ignored, missing key = safe default
- [x] `modules/billing/usage.ts`: live counts per head for one tenant + across an account (`forEachTenant`)
- [x] `modules/billing/service.ts`: `getEntitlements`, `assertFeature`, `assertCanAddHead` (advisory lock `cap:<cap>:<accountId>`), `accountForNewInstitute` (find, claim by phone, or create with trial)
- [x] `modules/billing/index.ts`: public surface only
- [x] Students: replace `assertStudentCapacity` in `students/routes.ts` (create, restore) and `students/import.ts` with `assertCanAddHead('student')`
- [x] Delete `apps/api/src/lib/plans.ts`
- [x] `POST /tenants` (`tenancy/routes.ts`): attach the new institute to `accountForNewInstitute(user)`; check `cap.institutes`
- [x] `GET /tenants/:tenantId` returns `entitlements` (SAAS_PLAN §7.6); old `usage` field removed (only the plan card used it)

### Web
- [x] `lib/entitlements.ts` types; `DashboardShell` stores `entitlements` in `TenantDataContext`
- [x] Settings plan card reads `entitlements`: state badge (trial days left / active / payment due / overdue / suspended), student bar when capped; old flat-plan text replaced in `si`, `ta`, `en`

### Tests and release
- [x] Port `apps/api/test/plans.test.ts` to accounts (set caps through price book/overrides instead of `tenants.plan`)
- [x] Tests: account-wide cap across two institutes of one account; two desks adding the last allowed student at once → one succeeds
- [x] Tests added: 12 resolver unit tests (`billing-resolve.test.ts`), 15 billing integration tests (`billing.test.ts`), 3 db tests (`forEachTenant` ×2, append-only audit); suite: 125 API + 17 web + 11 db passing; `migrate check` passes
- [ ] Release Phase 1 to production; check one existing institute's Settings page and student add still work

---

## Phase 2: Metering and invoices (admin-side)

Goal: head counts are recorded automatically and monthly invoices can be generated and paid. SAAS_PLAN §6, §8.2.

### Metering
- [ ] Migration `014_usage_metering`: table `tenant_usage_daily` **with forced RLS** (`enableTenantRls`; the db isolation test requires it), trigger function (`SECURITY INVOKER`)
- [ ] 014: statement-level `AFTER INSERT / UPDATE / DELETE` triggers with transition tables on `students`, `membership_roles`, `tenant_memberships`
- [ ] 014: backfill today's counts for every institute (per-tenant context)
- [ ] Day boundary uses Asia/Colombo date (same rule as `lib/time.ts`)
- [ ] Tests `apps/api/test/metering.test.ts`: student add / deactivate / restore / delete; CSV import of 500 rows writes one count; teacher accept and remove; parent accept counted, parent invite not counted; `count_max` keeps the day's peak, `count_last` the latest

### Invoices
- [ ] `modules/billing/invoice.ts`: pure `computeInvoice(dailyCounts, values, trialEndsAt, period)` (SAAS_PLAN §6.2)
- [ ] Unit tests `test/billing-invoice.test.ts`: peak summed across institutes per day; carry-forward of days without rows; opening value from before the month; trial days excluded; free allowance; minimum charge line; zero-head account; rounding to cents with `lib/money.ts`
- [ ] `usage.ts`: daily series per account for a month from `tenant_usage_daily`, read per institute with `forEachTenant`
- [ ] `service.ts`: `generateInvoices(period)` (lock `invoice:<accountId>`, `UNIQUE (account_id, period)`, number `S-YYYY-MM-NNNN`, due date from settings, lines snapshot)
- [ ] `service.ts`: `recordPayment(invoiceId, { amount, reference, clientRef })` (part payments; invoice `paid` when sum ≥ total) and `voidInvoice(invoiceId, reason)`
- [ ] Audit row in the same transaction for generate, payment and void
- [ ] Tests: generating twice is a no-op; price change after generation doesn't change the invoice; same `clientRef` records once; account goes overdue / restricted / back to active as invoices age and get paid
- [ ] Temporary admin script `npm run billing -w apps/api -- generate <YYYY-MM> | pay <invoice> <amount> <ref>` (uses the same service functions; removed in Phase 3)
- [ ] Runbook `docs/runbooks/billing.md`: monthly steps until the console exists
- [ ] Release Phase 2; check `tenant_usage_daily` fills on production after a student is added

### Done check
- [ ] A seeded month with heads changing across two institutes produces the expected invoice to the cent
- [ ] `migrate check` passes with 013 + 014
- [ ] No change visible to customers

---

## Phase 3: Super admin console

Goal: everything in the old SQL runbook is done from `/admin`, audited. SAAS_PLAN §10.

### API
- [ ] `plugins/platform-admin.ts`: `requirePlatformAdmin` (404 for non-admins), session younger than 12 h, stricter rate limit on mutations
- [ ] `modules/platform/routes.ts` registered at `/api/v1/admin` in `app.ts`
- [ ] `GET /accounts` (search, state filter, heads now, estimate, amount due) reading `tenant_usage_daily` per institute (`forEachTenant`); add a monthly rollup table if the list gets slow
- [ ] `POST /accounts` (create for owner phone, price book, trial days) + WhatsApp sign-up message link
- [ ] `GET /accounts/:id` (state, values with overrides, daily usage, institutes by name, invoices, payments, audit)
- [ ] `PATCH /accounts/:id` (name, notes, price book)
- [ ] `PUT / DELETE /accounts/:id/overrides/:key` (validated against the catalogue; note required; optional expiry)
- [ ] `POST /accounts/:id/trial`, `/suspend`, `/unsuspend`
- [ ] `POST /invoices/generate`, `GET /invoices`, `POST /invoices/:id/payments`, `POST /invoices/:id/void`
- [ ] `GET / PUT / POST /price-books` (validated; response includes number of affected accounts)
- [ ] `GET / PUT /settings`
- [ ] `GET /audit`
- [ ] Every mutation goes through `billing/service.ts` and writes one audit row (actor, account, before, after, IP)
- [ ] `/auth/me` returns `isPlatformAdmin`
- [x] Account claiming: unclaimed account with matching `owner_phone` is claimed on first `POST /tenants` (SAAS_PLAN §10.3) (done in Phase 1, tested in `billing.test.ts`)

### Web (`app/[lang]/admin/**`, `components/admin/**`)
- [ ] Admin layout + shell (separate menu, "Platform admin" bar); non-admins redirected to `/app`
- [ ] Accounts list with filters (trial ending in 7 days, overdue, restricted, suspended) + WhatsApp reminder button
- [ ] New account form
- [ ] Account detail: state, values (overrides highlighted), heads per day, institutes, invoices with Record payment, Extend trial, Suspend/Unsuspend, overrides editor, audit history
- [ ] Invoices page: month picker, Generate for month (shows totals first), list, CSV export
- [ ] Price books editor (books × keys grid, "affects N accounts" confirmation)
- [ ] Settings page and Audit page
- [ ] Header link to the console for platform admins
- [ ] Admin strings in `si`, `ta`, `en`

### Tests, docs and release
- [ ] `apps/api/test/platform.test.ts`: non-admin gets 404 on every admin route; each mutation writes exactly one audit row; override changes the next invoice but not past ones; price book edit rejects unknown keys; claiming by phone
- [ ] Remove the temporary billing script from Phase 2
- [ ] Rewrite `docs/runbooks/plans.md` and `billing.md` for the console; keep SQL only for granting the first admin
- [ ] Release Phase 3; grant your own user platform admin on production and generate a test invoice for a test account
- [ ] In the console Settings page, enter the bank details and support WhatsApp number before generating the first real invoice

---

## Phase 4: Customer billing, trial, restrictions and feature gates

Goal: customers see their trial, bill and locks; rules are enforced. SAAS_PLAN §5.2, §7.3, §6.4.

### API
- [ ] `plugins/entitlements.ts`: `config: { feature }` gate after `loadTenant`; typed `FastifyContextConfig`; `req.entitlements()` memoised per request
- [ ] Same plugin: suspended account + non-GET → `403 account_suspended` for everything under `/tenants/:tenantId`
- [x] Restricted state: `assertCanAddHead` → `403 account_restricted { amountDue, invoiceNumber }`; fee routes unaffected (done in Phase 1 for students; teacher/parent call sites come with the caps below)
- [ ] Feature gates: reports (`reports/routes.ts`), student import, slips (desk + family upload), live link set (`classes/routes.ts`), portal invites
- [ ] Portal hides `liveUrl` when `feature.live_links` is off (`portal/routes.ts`)
- [ ] Caps: teacher/admin/receptionist on staff invite create + accept; parent on portal invite accept (`staff/routes.ts`)
- [x] New self-service accounts get `trial_ends_at = now + trial_days` and expiring trial-cap overrides (done in Phase 1)
- [ ] `GET /tenants/:tenantId/billing` (owner, admin): prices, this month so far via `computeInvoice`, invoices, pay-to details (SAAS_PLAN §7.6)

### Web
- [ ] Billing page `app/[lang]/t/[tenantId]/billing/page.tsx` + `components/billing/billing-page.tsx`: this month estimate, invoices, bank details, "Send slip on WhatsApp" button with invoice number and amount
- [ ] "Billing" menu item for owner and admin (`lib/nav.ts`); Settings plan card replaced by a link to Billing
- [ ] `account-banner.tsx` in the shell: trial (days left), overdue (amount, due date), restricted, suspended
- [ ] `lib/nav.ts` `feature?` key; lock icon on locked menu items; `<Locked>` card on gated pages
- [~] Error messages for `plan_limit` (per key), `feature_locked`, `account_restricted`, `account_suspended` in `si`, `ta`, `en` (all four added in Phase 1; `plan_limit` is still one generic text, per-key text pending)
- [ ] Check in the browser at phone and desktop width in all three languages

### Tests and release
- [ ] `apps/api/test/entitlements.test.ts`: each feature gate on/off; trial caps; trial end starts billing on the next invoice
- [ ] Tests: overdue → restricted after grace blocks only new heads; fee collection and invoice generation still work when restricted
- [ ] Tests: suspended → GET works, POST/PUT/PATCH/DELETE return 403; family users blocked only when suspended
- [ ] Tests: staff invite and accept refused at the teacher cap; parent accept refused at the parent cap
- [ ] Release Phase 4; sign up a new test account on production and see the trial banner and Billing page

---

## Phase 5: Contract and harden

- [ ] Migration `015_drop_tenant_plan`: drop `tenants.plan`, `tenants.plan_expires_at` and their constraints (only after Phase 1 has been live for at least one release)
- [ ] Load check: 300 seeded accounts → console accounts list under 1 s, invoice generation for a month under 10 s
- [ ] Console "Recount" action: rewrite today's `tenant_usage_daily` rows from live counts for one account (SAAS_PLAN §13)
- [ ] Update [UI_UX.md](UI_UX.md): Billing page, banners, locks, admin console
- [ ] Update [RELEASE_V1.md](RELEASE_V1.md) and the landing page pricing text
- [ ] Mark `docs/runbooks/plans.md` replaced; link the console runbook from [runbooks/deploy.md](runbooks/deploy.md)
- [ ] Update [TASKS.md](../TASKS.md) and this file's progress line
- [ ] Release Phase 5

---

## Later (not in this plan's scope)

See SAAS_PLAN §12 for how each fits.

- [ ] 2FA for platform admins, then allow adding admins from the console
- [ ] PayHere card payments → `billing.recordPayment` from a webhook
- [ ] Worker: generate invoices on the 1st and send reminders automatically
- [ ] Prorated billing option
- [ ] WhatsApp/SMS credits as metered usage on the same invoice
- [ ] Several managers per account (`account_members`)
- [ ] Read-only, time-boxed "view as customer" for support
