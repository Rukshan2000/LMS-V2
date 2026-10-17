# Release v1.0 Plan: No Meta Business, No Payment Gateway

**Date:** 2026-10-17  
**Goal:** Ship a version real teachers can use **without** a business registration, Meta Business verification (WhatsApp Cloud API) or a PayHere merchant account.  
**Target users:** online/hybrid teachers and small classes up to 300 students ([persona P1, P3](STEP0_USER_RESEARCH.md#2-personas-built-from-evidence)).  
**Promise for v1:** *"Student uploads slip, you approve with one tap, the live class link unlocks, and parents get a WhatsApp from your own phone."*  
**Also not in v1:** Sentry (error tracking) and Bunny Stream (recorded lessons). Both move to v1.1.

---

## 1. What replaces the blocked services

| Blocked service | v1 replacement | Needs business? | Limit |
|---|---|---|---|
| PayHere online payment | **Cash at desk + bank slip upload → staff verify** | No | Staff must verify each slip (one tap) |
| WhatsApp Cloud API (auto messages) | **Click-to-WhatsApp links** (`https://wa.me/94XXXXXXXXX?text=...`): app pre-writes the message, staff taps **Send** in their own WhatsApp | No | One tap per message; sent from the teacher's own number |
| SMS gateway | **Web push** (PWA) + in-app notices for students/parents | No | iPhone needs iOS 16.4+ and "Add to Home Screen" |
| Email | Password reset and receipts via **Gmail SMTP + App Password** (nodemailer) | No | ~500 recipients/day, sent from a @gmail.com address; backup channel only. Move to Resend/SES with your domain in v2 |

**Why this is fine for v1:** today teachers already do everything by hand on WhatsApp. v1 cuts their work from "read slip → check bank → type message → add to group" to "check bank → tap Approve → tap Send". Full automation comes in v2.

### Click-to-WhatsApp examples
```text
Receipt:     "Kasun attended Combined Maths (A/L 2027) at 4:05 PM. Paid for October ✅ – Nimal Sir"
Reminder:    "October class fee LKR 8,000 for Kasun is due on the 5th. Upload slip: https://app.../pay/abc"
Approved:    "Payment received ✅. October class link unlocked: https://app.../l/abc"
Result:      "Kasun scored 78/100 in Term Test 2. Class rank: 12/140."
```
- Build the link on the server, URL-encode the text, and use the guardian's phone in `94XXXXXXXXX` format.
- Bulk reminders: show a list with one **Send** button per parent, and mark each as sent when tapped. 30 parents is about 30 taps, which is acceptable for v1.
- Record each as a `notifications` row with `channel = 'wa_link'` and `status = 'opened'`. We cannot confirm delivery, and that is fine.
- v2 switches the same templates to the Cloud API. Keep the message text in one templates file now.

---

## 2. v1.0 scope

### In v1.0
| Area | What ships |
|---|---|
| Onboarding | Self-serve signup, create class/institute, Sinhala/English UI (Tamil in v1.1) |
| Users & roles | Owner, teacher, receptionist, student, parent. Login by phone + password |
| Students | Add, CSV import, guardian phone, student number, search |
| Classes | Subjects, batches, enrollments, weekly timetable, cancel/reschedule a session |
| Attendance | QR class card (print PDF), phone-camera scan, manual mark, no duplicates, fee status shown on scan |
| Fees | Monthly fees (`class`, `ac`, `tute`, `admission`), free/half/sibling cards, cash payment, receipt PDF, **"not paid this month" list** |
| Slips | Student/parent uploads slip photo → staff view, enter bank ref, **Approve / Reject**. Duplicate slip (same image hash or reference) is flagged |
| Access unlock | Approved payment for a month unlocks that month's **live class link** |
| Live classes | Teacher pastes a Zoom/Meet link per session. Paid students see it in the portal. No shared group link |
| Messages | Click-to-WhatsApp for attendance, receipts, reminders and approvals. Web push + in-app notices |
| Portals | Student/parent: timetable, attendance, fees, upload slip, live links |
| Reports | Daily collection, monthly collection, attendance by batch, CSV export |
| Plans | ~~Free up to 50 students; paid plans enabled manually~~ (shipped in v1.0, ADR 008). **Replaced by per-head billing** (ADR 009, [SAAS_PLAN.md](SAAS_PLAN.md)): 30-day free trial, then a monthly invoice per active student, teacher and parent; prices, caps and features set by the platform admin in the console; customers pay by bank transfer and send the slip on WhatsApp from the Billing page |
| Ops | Staging + production, daily backups, restore tested, structured server logs (pino) kept 14 days. Uptime check moves to v2 |

### Cut to v1.1 (no blockers, just time)
- Recorded lessons on Bunny Stream (signed playback, watermark, device limit). Unlock uses the same verified-payment rule as live links
- Sentry error tracking (until then, read server logs and pilot teachers' reports)
- Offline scan queue
- Paper exam marks + class ranks, MCQ tests
- Tutes handout tracking
- Teacher payout statements (needed for institutes, not solo teachers)
- Tamil UI
- Multi-teacher institute features

### Cut to v2 (blocked by accounts)
- PayHere online payment + webhook auto-unlock → needs business registration + merchant
- WhatsApp Cloud API auto messages → needs Meta Business verification
- SMS fallback → needs SMS gateway + sender mask

---

## 3. Design rules so v2 is easy

1. **Payment status flow is the same in v1 and v2:** `pending → verified / rejected`. A slip approval and a future PayHere webhook both end in the same `verifyPayment()` service. v2 only adds a new caller.
2. **Access unlock depends only on a verified payment**, never on how the student paid.
3. **Message templates live in one file**, keyed by event (`attendance.marked`, `payment.verified`, ...). v1 renders them into `wa.me` links; v2 sends the same keys through the Cloud API.
4. **Keep the `notifications` table with a `channel` column** (`wa_link`, `push`, `in_app`, later `whatsapp_api`, `sms`).
5. Do **not** build abstractions for gateways now. Add them in v2 when the second implementation exists.

---

## 4. Database migrations for v1

```text
001_extensions_and_users
002_tenants_memberships_roles            (RLS)
003_students_guardians                   (RLS)
004_subjects_batches_enrollments         (RLS)
005_class_sessions                       (RLS, includes live_link column)
006_student_cards_attendance             (RLS)
007_fee_plans_concessions_invoices       (RLS)
008_payments_allocations_slips_receipts  (RLS, slip image hash unique per tenant)
009_notifications                        (RLS, channel column)
010_plans_subscriptions_usage
011_files_audit_logs
```
Deferred tables (lessons/videos, payouts, tutes, assessments, gateway events, outbox worker) arrive with their v1.1/v2 features. No empty tables "for later".

**No Redis/BullMQ in v1.** Nothing needs background delivery yet: PDFs are generated on request, and `wa.me` links are opened by staff. Add the worker in v2 with the Cloud API.

---

## 5. Build order and timeline

Estimates are for **one developer**. Each slice ships to staging when done.

| Week | Work | Release point |
|---|---|---|
| 1 | Repo, local Postgres, CI, DB roles, migrations 001–002, isolation tests | |
| 2 | API skeleton, auth (phone + password), tenant plugin, staging deploy | |
| 3 | Next.js shell, si/en i18n, signup → create class → dashboard | **Internal alpha** |
| 4–5 | Students, guardians, CSV import, batches, enrollments, timetable/sessions | |
| 6–7 | QR cards (PDF), scan screen, attendance, click-to-WhatsApp attendance message | **Pilot 1 starts: one friendly teacher, free** |
| 8–9 | Fees, concessions, invoices, cash payment, receipt PDF, not-paid list, reminder links | |
| 10 | Slip upload + verify + duplicate flagging, access unlock | |
| 11 | Live links per session (paid students only) | |
| 12 | Student/parent portal, web push | |
| 13 | Reports, plan limits (free cap 50), manual plan activation | **Beta: 3–5 teachers** |
| 14–15 | Fix pilot feedback, load test scan burst + billing, restore drill, privacy notice, Sinhala review | **v1.0 public release** |

With a 2–3 person team: about 8–9 weeks.

---

## 6. Accounts needed for v1 (no business registration)

| Account | Cost | When |
|---|---|---|
| GitHub | Free | Week 1 |
| Subdomain on existing domain | Have it ✓ | Week 2 |
| Hosting (existing) — must run Node.js, Docker and PostgreSQL 16 | Have it ✓ | Week 2 |
| Gmail (2-Step Verification on, App Password for SMTP) | Free | Week 2 |

v1.1 adds Sentry (free tier) and Bunny Stream (~USD 0.03/GB delivery). v2 adds an uptime check (UptimeRobot free).

Start the **business registration in parallel** now. It takes weeks and unlocks v2.

---

## 7. v1.0 release checklist

- [ ] Teacher can sign up and run a class day alone: enroll → print cards → scan → collect cash → receipt
- [ ] Online student can upload slip → staff approves → live link unlocks in under 1 minute
- [x] Unpaid student cannot see the live link (API test `portal.test.ts`)
- [x] Duplicate scan, duplicate slip and double approve are all safe (API tests: simultaneous scans/payments/verifies, slip hash + reference flags)
- [ ] Every WhatsApp link opens with the correct parent number and message, in Sinhala and English
- [x] Tenant isolation tests pass: API, files, slip images (RLS tests + `slips.test.ts` cross-institute)
- [x] Free plan blocks the 51st student without deleting data (`plans.test.ts`; since SaaS Phase 1 the trial cap does this, `billing.test.ts`)
- [ ] Backup restored on staging, steps documented
- [x] Privacy notice + parent consent at signup (`/privacy`, required checkbox, `users.privacy_accepted_at`)
- [ ] 3 pilot teachers used it for a full month of billing

---

## 8. After v1.0

| Version | Adds | Unblocked by |
|---|---|---|
| v1.1 | Recorded lessons (Bunny), Sentry, offline scan, exams + ranks, tutes, teacher payouts, Tamil | Time + card for Bunny |
| v2.0 | PayHere auto-pay + webhook unlock, WhatsApp Cloud API auto messages, SMS fallback, background worker, uptime check | Business registration, PayHere merchant, Meta verification |
