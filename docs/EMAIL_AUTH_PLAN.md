# Tuition LMS: email identity, OTP verification and email invitations

**Status:** Phases 1–4 built, 2026-10-17 (on top of `7e8840b`). Phase 5 waits until no user logs in by phone (the console shows the count).
**Changes:** login identity moves from **phone + password** to **verified email + password**. Every account, password reset and invitation goes through email, sent via Gmail SMTP.
**Supersedes:** "Phone OTP for students/parents later" in [ADR 003](adr/003-session-cookies.md). Recorded as [ADR 010](adr/010-email-identity.md).
**Does not change:** [ADR 006](adr/006-whatsapp-first.md). WhatsApp/SMS stays the channel for parent *notifications*. Email is only for identity and invitations.

---

## Contents

1. [Summary](#1-summary)
2. [What exists today](#2-what-exists-today)
3. [Target flows](#3-target-flows)
4. [OTP design](#4-otp-design)
5. [Mail delivery (Gmail SMTP)](#5-mail-delivery-gmail-smtp)
6. [Data model and migration](#6-data-model-and-migration)
7. [API](#7-api)
8. [Web](#8-web)
9. [Moving existing users](#9-moving-existing-users)
10. [Implementation phases](#10-implementation-phases)
11. [Tests](#11-tests)
12. [Risks and limits](#12-risks-and-limits)
13. [Open questions](#13-open-questions)

---

## 1. Summary

| Today | After |
|---|---|
| Sign up with phone + password, nothing verified | Sign up with email; a 6-digit code mailed to it must be entered before the user exists |
| Log in with phone + password | Log in with email + password |
| Forgot password: no flow | Code by email → new password → all sessions revoked |
| Console creates an account for an owner **phone** | Console creates an account for an owner **email**, and the owner gets an invitation email |
| Staff/portal invite = a link someone copies into WhatsApp | Invite is **emailed** with the link; only the user with that verified email can accept it |
| `users.email` exists, unused | `users.email` is required, unique (case-insensitive) and verified |

Rules that hold everywhere:

- **One email = one user.** Enforced by the existing `users_email_unique` index on `lower(email)`, not by app code.
- **No unverified user rows.** A user row is created only after the OTP is checked, so an address can never be "taken" by someone who does not own it.
- **Phone stays** as contact data (WhatsApp, guardian matching, receipts). It is no longer a login key.

---

## 2. What exists today

| Piece | Where | Note |
|---|---|---|
| Signup / login by phone | [identity/routes.ts](../apps/api/src/modules/identity/routes.ts) | argon2id, rate-limited per IP, constant-time on unknown user |
| Sessions | [plugins/auth.ts](../apps/api/src/plugins/auth.ts) | `auth_sessions`, SHA-256 token hash, HttpOnly cookie. **Kept as is.** |
| `users` table | [001](../packages/db/migrations/001_extensions_and_users.ts) | `phone` NOT NULL UNIQUE; `email` nullable with a unique `lower(email)` index |
| Staff invites | [staff/routes.ts](../apps/api/src/modules/staff/routes.ts) | `tenant_invites` keyed on `phone`; link `/join/<tenantId>.<token>`; accept checks `invite.phone === user.phone` |
| Portal invites | [portal/routes.ts](../apps/api/src/modules/portal/routes.ts) | Phone must be the student's or a guardian's |
| Console account creation | `createAccount` in [billing/service.ts](../apps/api/src/modules/billing/service.ts) | `accounts.owner_phone`; claimed by `accountForNewInstitute` when that phone creates an institute |
| Mail | none | No mailer, no SMTP settings, no `APP_URL` |

The session layer, RLS and invite-token design are sound and stay. The change is only **which identifier proves who you are** and **how codes and links reach people**.

---

## 3. Target flows

### 3.1 Sign up (only for people with an invite or a console-created account)

```
Browser                         API                                   Gmail
  │ POST /auth/signup/start {email}                                     │
  │──────────────────────────────▶│ email already a user?                │
  │                               │  yes → mail "you already have an     │
  │                               │        account, log in / reset"      │
  │                               │  no  → create OTP(signup), mail code ─▶ 
  │◀── 202 "check your email" ────│ (same answer either way)             │
  │ POST /auth/signup/verify {email, code, fullName, password, phone?}   │
  │──────────────────────────────▶│ check OTP → insert user              │
  │                               │ email_verified_at = now()            │
  │◀── 201 + session cookie ──────│                                      │
```

Same response whether the email is registered or not, so signup cannot be used to find out who has an account.

### 3.2 Log in

`POST /auth/login {email, password}`. Same code as today with `email` in place of `phone`. No OTP on every login (decided below, [§13](#13-open-questions)).

### 3.3 Forgot password

1. `POST /auth/password/forgot {email}` → always `202`. If the user exists, mail an OTP (`purpose = 'password_reset'`).
2. `POST /auth/password/reset {email, code, password}` → check OTP, set the new hash, **revoke every session of that user**, start a fresh one.

### 3.4 Change email (logged in)

1. `POST /auth/email/change {email, password}` → re-check password, mail an OTP to the **new** address (`purpose = 'email_change'`).
2. `POST /auth/email/confirm {email, code}` → swap the email; mail a notice to the **old** address ("your login email was changed").

### 3.5 Console creates an account (platform admin)

1. Admin enters institute name + **owner email** (+ price book, trial days).
2. `createAccount` stores `accounts.owner_email`, then mails the owner: "Your institute account is ready, create your login" → link to `/signup?email=…`.
3. The owner verifies by OTP and signs up. When they create their institute, `accountForNewInstitute` claims the account by **verified email** instead of phone.
4. Console gets a **Resend invitation** button on the account page.

### 3.6 Staff and portal invites

1. Manager enters name + **email** + role (staff) or desk picks a student/guardian **email** (portal).
2. API creates the `tenant_invites` row exactly as today, then mails the link `APP_URL/<lang>/join/<tenantId>.<token>`. The response still returns the code, so the "copy link / send on WhatsApp" button keeps working as a fallback.
3. Recipient opens the link → logs in or signs up (the email field is pre-filled and read-only, like the phone field today).
4. Accept checks `invite.email === user.email` and `user.email_verified_at IS NOT NULL`. A forwarded link is still useless to anyone else.
5. Invite list gets **Resend email** (new token, old one revoked, same as re-inviting today).

---

## 4. OTP design

| Property | Value | Why |
|---|---|---|
| Code | 6 digits from `crypto.randomInt(0, 1_000_000)`, zero-padded | Easy to type on a phone |
| Stored as | `sha256(purpose + ':' + lower(email) + ':' + code)` | Raw code never stored; a code for one purpose/email cannot be replayed for another |
| Lifetime | 10 minutes | |
| Wrong attempts | 5, then the code is dead; request a new one | 5 guesses in 10⁶ is safe |
| Resend | Not within 60 s of the last code; max 5 codes per email per hour | Stops mail-bombing someone and protects the Gmail quota |
| One live code | Sending a new code consumes older pending codes for the same email + purpose | |
| Comparison | `timingSafeEqual` on the hashes | |
| Per-IP limit | Existing `authRateLimitMax` on every `/auth/*` route | Already in place |

All of this is one small module, `apps/api/src/modules/identity/otp.ts`, with two functions:

```ts
issueOtp(trx, { email, purpose }): Promise<string>        // returns the code to mail; throws 429 otp_too_soon
consumeOtp(trx, { email, purpose, code }): Promise<void>  // throws 400 otp_invalid / otp_expired
```

No OTP library is needed; `node:crypto` covers it.

---

## 5. Mail delivery (Gmail SMTP)

### 5.1 Transport

- **Dependency:** `nodemailer` (the one new package). It handles SMTP, STARTTLS and pooling.
- **Module:** `apps/api/src/lib/mail.ts`: one `sendMail({ to, subject, text, html })` built from env at startup. Nothing else in the code knows about SMTP.
- **Templates:** `apps/api/src/lib/mail-templates.ts`: plain functions returning `{ subject, text, html }`: `otpMail`, `inviteMail`, `accountReadyMail`, `emailChangedMail`. Plain text is always included. English first; si/ta use the same dictionary keys as the web later.
- **Tests:** the app takes a `mailer` option like it takes `db`. Tests pass a stub that records messages, so a test reads the OTP from the "inbox". Nothing touches Gmail in CI.

### 5.2 Configuration

New env vars, validated in [env.ts](../apps/api/src/env.ts) with zod:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587               # STARTTLS
SMTP_USER=<gmail address>
SMTP_PASSWORD=<Google app password>
SMTP_FROM_NAME=<sender name>
SMTP_FROM_EMAIL=<gmail address>   # Gmail rewrites any other From to SMTP_USER
APP_URL=https://<web host>        # base for links in emails
```

- **Where the real values go:** local `.env` (gitignored) and `deploy/app.env` on the server. **Never** in `.env.example`, docs or commits; `.env.example` gets placeholders only.
- **Gmail needs:** 2-Step Verification on the Google account and an **App Password** (the 16-character value). A normal Gmail password will not work.
- **Sender name:** the supplied config says `SMTP_FROM_NAME=Guest Book`. Change it to the product name, or users will think the mail is spam.

### 5.3 When mail is sent, and what if it fails

- Mail is sent **after the DB transaction commits**, never inside it (no rolled-back invite with a sent email; no long-held row locks waiting on SMTP).
- OTP mails: sent in the request. If SMTP fails → `503 mail_unavailable`; the OTP row stays, so the user can press "resend" after 60 s.
- Invite and account-ready mails: sent in the request. If SMTP fails, the invite is still created and the response says `emailSent: false`; the UI shows the copy-link fallback and a **Resend** button.
- `// ponytail:` no outbox table or retry worker in v1. Add an `outbox` table + a worker when mail volume or reliability needs it (same time as the move off Gmail, §12).

### 5.4 Deliverability

- Gmail signs with DKIM for `@gmail.com` itself, so no DNS work is needed while sending from a Gmail address.
- Moving to a custom domain later (e.g. `no-reply@<product>.lk`) means SPF, DKIM and DMARC records on that domain and a transactional provider (§12).

---

## 6. Data model and migration

One migration: **`018_email_identity.ts`** (016 is held on `saas-phase5-drop-tenant-plan`, 017 is quizzes).

### 6.1 Changed tables

```sql
-- users: email becomes the login key; phone becomes optional contact data
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;   -- unique index on phone stays (NULLs allowed)
-- users_email_unique ON lower(email) already exists (001). Reused, not recreated.
-- NOT NULL on email comes in a later migration, after existing users have moved (§9).

-- accounts: console accounts are created for an email
ALTER TABLE accounts ADD COLUMN owner_email varchar(254);
ALTER TABLE accounts ALTER COLUMN owner_phone DROP NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT accounts_owner_contact
  CHECK (owner_email IS NOT NULL OR owner_phone IS NOT NULL);
CREATE INDEX accounts_owner_email ON accounts (lower(owner_email)) WHERE owner_user_id IS NULL;

-- tenant_invites: invites go to an email
ALTER TABLE tenant_invites ADD COLUMN email varchar(254);
ALTER TABLE tenant_invites ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE tenant_invites ADD CONSTRAINT tenant_invites_contact
  CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- guardians / students: an optional email so portal invites can be checked like phones are now
ALTER TABLE guardians ADD COLUMN email varchar(254);
ALTER TABLE students  ADD COLUMN email varchar(254);
```

### 6.2 New table

```sql
-- Global (no tenant_id, no RLS), like users and auth_sessions.
CREATE TABLE email_otps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        varchar(254) NOT NULL,          -- stored lower-cased
  purpose      varchar(16)  NOT NULL CHECK (purpose IN ('signup', 'password_reset', 'email_change')),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,  -- set for email_change / password_reset
  code_hash    char(64)     NOT NULL,
  attempts     smallint     NOT NULL DEFAULT 0,
  expires_at   timestamptz  NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_lookup ON email_otps (email, purpose, created_at DESC);
```

Old rows are harmless; a one-line `DELETE … WHERE created_at < now() - interval '7 days'` can run in the deploy script or a cron later.

---

## 7. API

All under `/api/v1/auth`, all with the existing per-IP rate limit.

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/signup/start` | `{ email }` | `202` always |
| POST | `/signup/verify` | `{ email, code, fullName, password, phone?, acceptPrivacy }` | `201` + session; `400 otp_invalid` |
| POST | `/login` | `{ email, password }` | `200` + session; `401 invalid_credentials` |
| POST | `/password/forgot` | `{ email }` | `202` always |
| POST | `/password/reset` | `{ email, code, password }` | `200` + new session; all old sessions revoked |
| POST | `/email/change` | `{ email, password? }` | `202`; `409 email_taken`. Password required only when the user already has a verified email, so phone-only users add their first email here too (§9) |
| POST | `/email/confirm` | `{ email, code }` | `200` |

Other routes that change:

| Route | Change |
|---|---|
| `POST /tenants/:id/invites` | `phone` → `email`; already-member check by email; mails the link; returns `{ invite, code, emailSent }` |
| `POST /tenants/:id/invites/:inviteId/resend` | **New.** New token, old revoked, mail again |
| `POST /tenants/:id/students/:sid/portal-invite` | `phone` → `email`; must equal the student's or a guardian's stored email |
| `POST /invites/:code/accept` | Match on `invite.email` and require `email_verified_at`; phone-only invites created before the change still match on phone until they expire (14 days) |
| `POST /admin/accounts` | `ownerPhone` → `ownerEmail`; mails "account ready" |
| `POST /admin/accounts/:id/invite` | **New.** Resend the owner email |
| `GET /auth/me` | Adds `email`, `emailVerified` |
| `accountForNewInstitute` | Claims an unclaimed account by `lower(owner_email) = lower(user.email)`, only if the user's email is verified. Falls back to `owner_phone` for accounts made before the change |

`SessionUser` in [auth.ts](../apps/api/src/plugins/auth.ts) gets `email` and `emailVerified`; `phone` becomes `string | null`.

Email input is normalised once: `z.email().trim().toLowerCase().max(254)`. That shared schema lives in `apps/api/src/lib/email.ts`, next to `phone.ts`.

---

## 8. Web

| Page / component | Change |
|---|---|
| [auth-form.tsx](../apps/web/src/components/auth-form.tsx) | Email field instead of phone. Signup becomes two steps: email → code + name + password (+ optional phone) |
| `login/page.tsx` | Email + password; "Forgot password?" link |
| `forgot-password/page.tsx` | **New.** Email → code + new password |
| `account/email/page.tsx` | **New.** Gate for existing users without a verified email (§9), and "change login email" for everyone (the name in the header links here) |
| [join-invite.tsx](../apps/web/src/components/join-invite.tsx) | Pre-fills the invite's email, read-only |
| [staff-settings.tsx](../apps/web/src/components/settings/staff-settings.tsx) | Invite by email; "Email sent" / "Resend" / copy-link fallback |
| [portal-invite.tsx](../apps/web/src/components/students/portal-invite.tsx) | Pick student/guardian email |
| [student-form.tsx](../apps/web/src/components/students/student-form.tsx) | Optional email for student and guardians |
| [admin/accounts](../apps/web/src/components/admin/accounts.tsx), [account-detail](../apps/web/src/components/admin/account-detail.tsx) | Owner email; "Resend invitation" |
| Dictionaries en / si / ta | New strings for every message above |

OTP input: `<input inputMode="numeric" autoComplete="one-time-code" maxLength={6}>`. No library.

---

## 9. Moving existing users

Existing users have a phone and a password but usually no email. No one is locked out:

1. **Transition login.** `/auth/login` accepts `{ identifier, password }`: an `@` means email, otherwise phone. Phone login works only for users **without** a verified email.
2. **Verify gate.** After a phone login, `/auth/me` returns `emailVerified: false`; the web sends the user to `/account/email`, where they enter an email, get a code and confirm (`/auth/email/change` without a password). Nothing else in the app opens until then.
3. **Console view.** The accounts list shows how many users are still unverified.
4. **Close the gap.** When the count is zero (or after a set date), a follow-up migration sets `users.email NOT NULL`, and the phone branch of login is deleted.

Platform admins go through the same gate on their next login.

---

## 10. Implementation phases

Each phase is one PR, green CI, deployable on its own.

| Phase | Scope | Visible change |
|---|---|---|
| **1. Mail + OTP core** | `nodemailer`, `lib/mail.ts`, templates, env vars, `email_otps` + migration 018, `otp.ts`, test mail stub | None yet |
| **2. Identity** | signup start/verify, email login + transition login, forgot/reset, email change, verify gate, web pages | Users sign up and log in by email |
| **3. Invites by email** | staff + portal invites by email, resend, accept by email, student/guardian email fields | Invites arrive in the inbox |
| **4. Console** | `ownerEmail`, account-ready mail, resend, claim by email, unverified-user count | Console accounts start with an email |
| **5. Cleanup** | `email NOT NULL`, remove phone login, ADR 010, update [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md) and the console Docs page | Phone login gone |

---

## 11. Tests

All in the existing Vitest suites with the mail stub:

- OTP: right code works once; wrong code ×5 kills it; expired code fails; code for `signup` fails for `password_reset`; resend within 60 s → 429; 6th code in an hour → 429.
- Signup: duplicate email (any case: `A@x.com` vs `a@X.com`) is rejected by the DB index; existing email gets the "already have an account" mail and the same 202.
- Reset: all old sessions revoked; old password stops working.
- Invites: accept with a different verified email → 403; with unverified email → 403; old phone invite still accepted by phone during the transition.
- Console: account by email is claimed by the verified owner only.
- Mail failure: OTP route → 503 with the OTP kept; invite route → 201 with `emailSent: false`.

---

## 12. Risks and limits

| Risk | Mitigation |
|---|---|
| **Gmail sending limit** (~500 recipients/day for a free Gmail account, ~2,000 for Google Workspace). One bulk import of portal invites can hit it, and then OTPs fail too. | Fine for the pilot. Before a wide launch, move to a transactional provider (Amazon SES, Postmark, Resend) with a domain sender. Only `lib/mail.ts` and env change. |
| Gmail flags the account for automated sending | Low volume, plain templates, a real From name, no link shorteners. |
| App password leak | Lives only in `.env` / `deploy/app.env`. If it is ever shared (chat, ticket, commit), revoke it in Google Account → Security → App passwords and create a new one. |
| Mail goes to spam | Plain-text part, product name as sender, the code in the subject line ("123456 is your login code"). |
| Account enumeration | Signup/forgot always return 202; login error does not say which part was wrong (as today). |
| Users without email (some parents) | Phone stays on students/guardians; the copy-link WhatsApp fallback for invites stays. A phone-only parent needs someone's email or waits for SMS/WhatsApp OTP (not in this plan). |

---

## 13. Open questions

1. **OTP on every login?** Proposed: no. Password + verified email is enough for v1; add "new device → email code" later if staff accounts get shared.
2. **Who may self-sign-up?** Proposed: anyone may create a *user*, but only console-created accounts or invites give them anything to do (as today: `no_account` without one).
3. **Sender identity:** keep the supplied Gmail address for the pilot, or set up a domain address now?
4. **Required email for parents?** Proposed: optional; invite falls back to the copy link.
