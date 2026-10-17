# SaaS Task List: accounts, per-head billing, trials, super admin

Based on [SAAS_PLAN.md](SAAS_PLAN.md) (§ numbers below point there). Mark `[x]` when done.

**Legend:** `[x]` completed · `[ ]` not completed · `[~]` in progress

**Progress:** Phase 0: 5/6 · Phase 1: 23/24 · Phase 2: 18/19 · Phase 3: 30/32 · Phase 4: 19/20 · Phase 5: 6/8

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
- [ ] Check prices with at least 2 pilot teachers before publishing them (SAAS_PLAN §13, first risk). **Owner's task; doesn't block Phase 1–3**, must be done before Phase 4 shows prices to customers. Phase 4 is built, so this now blocks the Phase 4 release
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
- [x] Settings plan card reads `entitlements`: state badge (trial days left / active / payment due / overdue / suspended), student bar when capped; old flat-plan text replaced in `si`, `ta`, `en` (card replaced by the Billing page in Phase 4)

### Tests and release
- [x] Port `apps/api/test/plans.test.ts` to accounts (set caps through price book/overrides instead of `tenants.plan`)
- [x] Tests: account-wide cap across two institutes of one account; two desks adding the last allowed student at once → one succeeds
- [x] Tests added: 12 resolver unit tests (`billing-resolve.test.ts`), 15 billing integration tests (`billing.test.ts`), 3 db tests (`forEachTenant` ×2, append-only audit); suite: 125 API + 17 web + 11 db passing; `migrate check` passes
- [ ] Release Phase 1 to production; check one existing institute's Settings page and student add still work

---

## Phase 2: Metering and invoices (admin-side)

Goal: head counts are recorded automatically and monthly invoices can be generated and paid. SAAS_PLAN §6, §8.2.

**Status:** built and committed to `main` 2026-10-17; not yet released to production (release after Phase 1). Differences from the plan are marked *(Phase 2)* in SAAS_PLAN §6.2, §6.3 and §8.1.

### Metering
- [x] Migration `014_usage_metering`: table `tenant_usage_daily` **with forced RLS** (`enableTenantRls`; the db isolation test requires it), trigger function (`SECURITY INVOKER`)
- [x] 014: statement-level `AFTER INSERT / UPDATE / DELETE` triggers with transition tables on `students`, `membership_roles`, `tenant_memberships`
- [x] 014: backfill today's counts for every institute (per-tenant context); rehearsed on a copy of dev data with a non-`BYPASSRLS` owner role (3 institutes, 15 rows, matches live counts)
- [x] Day boundary uses Asia/Colombo date (same rule as `lib/time.ts`)
- [x] Tests `apps/api/test/metering.test.ts`: student add / deactivate / restore / delete; CSV import of 500 rows writes one count; teacher accept and remove; parent accept counted, parent invite not counted; `count_max` keeps the day's peak, `count_last` the latest

### Invoices
- [x] `modules/billing/invoice.ts`: pure `computeInvoice(dailyCounts, values, trialEndsAt, period)` (SAAS_PLAN §6.2)
- [x] Unit tests `test/billing-invoice.test.ts`: peak summed across institutes per day; carry-forward of days without rows; opening value from before the month; trial days excluded; free allowance; minimum charge line; zero-head account; rounding to cents with `lib/money.ts`
- [x] `usage.ts`: daily series per account for a month from `tenant_usage_daily`, read per institute with `forEachTenant`
- [x] `service.ts`: `generateInvoices(period)` (lock `invoice:<accountId>`, `UNIQUE (account_id, period)`, number `S-YYYY-MM-NNNN`, due date from settings, lines snapshot)
- [x] `service.ts`: `recordPayment(invoiceId, { amount, reference, clientRef })` (part payments; invoice `paid` when sum ≥ total) and `voidInvoice(invoiceId, reason)`
- [x] Audit row in the same transaction for generate, payment and void
- [x] Tests: generating twice is a no-op; price change after generation doesn't change the invoice; same `clientRef` records once; account goes overdue / restricted / back to active as invoices age and get paid
- [x] Temporary admin script `npm run billing -w apps/api -- generate <YYYY-MM> | pay <invoice> <amount> <ref> | void <invoice> <reason>` (uses the same service functions; bundled as `dist/billing.js` for the server; acts as the platform admin in `BILLING_ADMIN_PHONE`; removed in Phase 3)
- [x] Runbook `docs/runbooks/billing.md`: monthly steps until the console exists
- [ ] Release Phase 2; check `tenant_usage_daily` fills on production after a student is added

- [x] Tests added: 11 invoice unit tests (`billing-invoice.test.ts`), 14 metering/invoice integration tests (`metering.test.ts`); suite: 150 API + 17 web + 11 db passing

### Done check
- [x] A seeded month with heads changing across two institutes produces the expected invoice to the cent
- [x] `migrate check` passes with 013 + 014
- [x] No change visible to customers

---

## Phase 3: Super admin console

Goal: everything in the old SQL runbook is done from `/admin`, audited. SAAS_PLAN §10.

**Status:** built and committed to `main` 2026-10-17; not yet released to production (release after Phases 1 and 2). Differences from the plan are marked *(Changed during Phase 3)* in SAAS_PLAN §6.1, §6.4, §7.5, §8.1, §8.2, §10.1, §10.2 and §10.4.

### API
- [x] `plugins/platform-admin.ts`: `requirePlatformAdmin` (404 for non-admins), session younger than 12 h, stricter rate limit on mutations
- [x] `modules/platform/routes.ts` registered at `/api/v1/admin` in `app.ts`
- [x] `GET /accounts` (search, state filter, heads now, estimate, amount due) reading `tenant_usage_daily` per institute (`forEachTenant`); add a monthly rollup table if the list gets slow
- [x] `POST /accounts` (create for owner phone, price book, trial days) + WhatsApp sign-up message link
- [x] `GET /accounts/:id` (state, values with overrides, daily usage, institutes by name, invoices, payments, audit)
- [x] `PATCH /accounts/:id` (name, notes, price book)
- [x] `PUT / DELETE /accounts/:id/overrides/:key` (validated against the catalogue; note required; optional expiry)
- [x] `POST /accounts/:id/trial`, `/suspend`, `/unsuspend`
- [x] `POST /invoices/generate`, `GET /invoices`, `POST /invoices/:id/payments`, `POST /invoices/:id/void`
- [x] `GET / PUT / POST /price-books` (validated; response includes number of affected accounts)
- [x] `GET / PUT /settings`
- [x] `GET /audit`
- [x] Every mutation goes through `billing/service.ts` and writes one audit row (actor, account, before, after, IP)
- [x] `/auth/me` returns `isPlatformAdmin`
- [x] Account claiming: unclaimed account with matching `owner_phone` is claimed on first `POST /tenants` (SAAS_PLAN §10.3) (done in Phase 1, tested in `billing.test.ts`)

### Web (`app/[lang]/admin/**`, `components/admin/**`)
- [x] Admin layout + shell (separate menu, "Platform admin" bar); non-admins redirected to `/app`
- [x] Accounts list with filters (trial ending in 7 days, overdue, restricted, suspended) + WhatsApp reminder button
- [x] New account form
- [x] Account detail: state, values (overrides highlighted), heads per day, institutes, invoices with Record payment, Extend trial, Suspend/Unsuspend, overrides editor, audit history
- [x] Invoices page: month picker, Generate for month (shows totals first), list, CSV export
- [x] Price books editor (books × keys grid, "affects N accounts" confirmation)
- [x] Settings page and Audit page
- [x] Header link to the console for platform admins
- [x] Admin strings in `si`, `ta`, `en`

### Tests, docs and release
- [x] `apps/api/test/platform.test.ts`: non-admin gets 404 on every admin route; each mutation writes exactly one audit row; override changes the next invoice but not past ones; price book edit rejects unknown keys; claiming by phone; admin login older than 12 h refused; mutation rate limit
- [x] Migration `015_invoice_regenerate_after_void`: a voided month can be generated again (partial unique index on live invoices); `drop_tenant_plan` moves to 016
- [x] `computeInvoice(..., lastDay?)` for the month-so-far estimate; unit test
- [x] Tests added: 15 platform integration tests (`platform.test.ts`), 1 invoice unit test; suite: 166 API + 17 web + 11 db passing; `migrate check` passes
- [x] Remove the temporary billing script from Phase 2
- [x] Rewrite `docs/runbooks/plans.md` and `billing.md` for the console; keep SQL only for granting the first admin
- [ ] Release Phase 3; grant your own user platform admin on production and generate a test invoice for a test account
- [ ] In the console Settings page, enter the bank details and support WhatsApp number before generating the first real invoice

---

## Phase 4: Customer billing, trial, restrictions and feature gates

Goal: customers see their trial, bill and locks; rules are enforced. SAAS_PLAN §5.2, §7.3, §6.4.

**Status:** built and committed to `main` 2026-10-17 (`cb6a6d3` API, `8c2e6c2` web and docs) and pushed; not yet released to production (release after Phases 1–3). No migration, so `016_drop_tenant_plan` keeps its number. Open points decided in SAAS_PLAN §7.7; differences from the plan are marked *(Changed during Phase 4)* in SAAS_PLAN §5.2, §7.3, §7.6, §9 and §11.

### API
- [x] `plugins/entitlements.ts`: `config: { feature }` gate after `loadTenant` (added per route through `onRoute`, after the route's own preHandlers); typed `FastifyContextConfig`; `req.entitlements()` memoised per request
- [x] Same plugin: suspended account + non-GET → `403 account_suspended` for everything under `/tenants/:tenantId`
- [x] Restricted state: `assertCanAddHead` → `403 account_restricted { amountDue, invoiceNumber }`; fee routes unaffected (students in Phase 1; staff and parent call sites in Phase 4)
- [x] Feature gates: reports (`reports/routes.ts`), student import, slips (desk + family upload), live link set (`classes/routes.ts`), portal invites
- [x] Portal hides `liveUrl` when `feature.live_links` is off (`portal/routes.ts`)
- [x] Caps: teacher/admin/receptionist on staff invite create + accept; parent on portal invite accept (`staff/routes.ts`)
- [x] New self-service accounts get `trial_ends_at = now + trial_days` and expiring trial-cap overrides (done in Phase 1)
- [x] `GET /tenants/:tenantId/billing` (owner, admin): prices, this month so far via `computeInvoice`, invoices, pay-to details (SAAS_PLAN §7.6)

### Web
- [x] Billing page `app/[lang]/t/[tenantId]/billing/page.tsx` + `components/billing/billing-page.tsx`: this month estimate, invoices, bank details, "Send slip on WhatsApp" button with invoice number and amount
- [x] "Billing" menu item for owner and admin (`lib/nav.ts`); Settings plan card replaced by a link to Billing
- [x] `account-banner.tsx` in the shell: trial (days left), overdue (amount, due date), restricted, suspended
- [x] `lib/nav.ts` `feature?` key; lock icon on locked menu items; `<Locked>` card on gated pages
- [x] Error messages for `plan_limit` (per key), `feature_locked`, `account_restricted`, `account_suspended` in `si`, `ta`, `en` (per-key `plan_limit` text added in Phase 4, chosen by `details.key`)
- [x] Check in the browser at phone and desktop width in all three languages

### Tests and release
- [x] `apps/api/test/entitlements.test.ts`: each feature gate on/off; trial caps; trial end starts billing on the next invoice
- [x] Tests: overdue → restricted after grace blocks only new heads; fee collection and invoice generation still work when restricted
- [x] Tests: suspended → GET works, POST/PUT/PATCH/DELETE return 403; family users blocked only when suspended
- [x] Tests: staff invite and accept refused at the teacher cap; parent accept refused at the parent cap
- [x] Tests added: 49 integration tests (`entitlements.test.ts`), 2 web nav tests; suite: 215 API + 19 web + 11 db passing; `migrate check` passes
- [ ] Release Phase 4; sign up a new test account on production and see the trial banner and Billing page. Before it: the Phase 0 price check, and bank details + support WhatsApp entered in the console Settings (Phase 3 release); without them the Billing page has no WhatsApp button

---

## Phase 5: Contract and harden

**Status:** built on `main` 2026-10-17 and pushed, except migration 016, which is written and checked on the branch `saas-phase5-drop-tenant-plan` and held there until Phase 1 has been live for one release. Not released.

- [~] Migration `016_drop_tenant_plan` (was 015 before Phase 3): drop `tenants.plan`, `tenants.plan_expires_at` and their constraints (only after Phase 1 has been live for at least one release). Written on branch `saas-phase5-drop-tenant-plan` (up → down → up passes on the test DB; no code reads the columns). Merge it into `main` in the release after Phase 1 has been live
- [x] Load check: 300 seeded accounts → console accounts list under 1 s, invoice generation for a month under 10 s. `LOAD_CHECK=1 npx vitest run test/load.test.ts` (in `apps/api`; skipped in `npm test`). Local result: list 267 ms, 300 invoices 340 ms (300 accounts, ~24,000 usage rows); production adds network latency per query, so re-run there if the list feels slow
- [x] Console "Recount" action: rewrite today's `tenant_usage_daily` rows from live counts for one account (SAAS_PLAN §13). `POST /admin/accounts/:id/recount` + **Recount today** on the account page; uses the triggers' `meter_tenant()`, so today's peak never goes down; audited (`account.recount`)
- [x] Update [UI_UX.md](UI_UX.md): Billing page, banners, locks, admin console
- [x] Update [RELEASE_V1.md](RELEASE_V1.md) and the landing page pricing text (no prices on the landing page: they are data and not yet checked with pilots; it says 30 days free, then a monthly fee per active student, teacher and parent)
- [x] Mark `docs/runbooks/plans.md` replaced; link the console runbook from [runbooks/deploy.md](runbooks/deploy.md) (plans.md was already rewritten for the console in Phase 3, so it is the console runbook now; deploy.md links it and billing.md)
- [x] Update [TASKS.md](../TASKS.md) and this file's progress line
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
