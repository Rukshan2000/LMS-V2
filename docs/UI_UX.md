# Tuition LMS: UI and UX (current state)

**As of:** 2026-10-17, production commit `e7a87d8` (v1.0 slices 1–9 live at https://lms.kwingsmedia.com)
**Code:** `apps/web/src` (Next.js 16 App Router, React 19, Tailwind CSS 4)
**Purpose:** a record of how the product looks and behaves today, for anyone designing or building the next screens. It describes what exists, not what is planned; gaps are listed in [§11](#11-known-gaps-and-inconsistencies).

---

## Contents

1. [Design principles](#1-design-principles)
2. [Users, roles and what each one sees](#2-users-roles-and-what-each-one-sees)
3. [Information architecture and URLs](#3-information-architecture-and-urls)
4. [App shell and navigation](#4-app-shell-and-navigation)
5. [Visual design](#5-visual-design)
6. [Components](#6-components)
7. [Interaction patterns](#7-interaction-patterns)
8. [Screens](#8-screens)
9. [Key flows end to end](#9-key-flows-end-to-end)
10. [Language, responsiveness, printing and accessibility](#10-language-responsiveness-printing-and-accessibility)
11. [Known gaps and inconsistencies](#11-known-gaps-and-inconsistencies)
12. [Rules for new screens](#12-rules-for-new-screens)

---

## 1. Design principles

These are the decisions the current UI follows. New screens should keep them.

| Principle | What it means in the UI |
|---|---|
| **Sinhala first** | Default language is Sinhala (`/si`). Every string is in a dictionary with Sinhala, Tamil and English. No English-only labels. |
| **Phone first, desk second** | Owners and parents use phones; the front desk uses a laptop with a USB scanner. Every screen works at phone width with no sideways scrolling. |
| **WhatsApp is the message channel** | The app writes the message; the user taps a green button that opens WhatsApp with the parent's number and text ready. Nothing is sent automatically in v1. |
| **One screen per job** | The desk scans on one screen, takes money on the student page, checks slips on one page. Parents get everything on one page. |
| **Plain words** | "Not paid", "Free card", "Send slip", not accounting or software terms. Fee words match Sri Lankan classes: class fee, AC fee, tute fee, free card, half card. |
| **Safe by default** | Repeated taps, double scans and double submits never create duplicates. Destructive actions are rare and need a second tap. |
| **Money and time are exact** | Amounts are always LKR with two decimals and thousands separators. Times are always Sri Lanka time, whatever the device clock zone. |

---

## 2. Users, roles and what each one sees

One person can hold several roles; the menu shows the union of their roles (duplicates removed).

| Role | Typical person | Menu items |
|---|---|---|
| **Owner** | Teacher running their own class, or institute owner | Overview, Scan, Students, Classes, Attendance, Fees, Bank slips, Timetable, Reports, Settings |
| **Admin** | Manager | Same as owner (cannot remove the owner) |
| **Receptionist** | Front desk | Overview, Scan, Students, Classes, Attendance, Fees, Bank slips, Timetable |
| **Teacher** | Teacher at an institute | Overview, Classes, Attendance, Timetable (sees only their own classes and students) |
| **Parent** | Guardian invited by WhatsApp link | Overview only (the portal) |
| **Student** | Student invited with their own mobile | Overview only (the portal) |

Source of truth: `apps/web/src/lib/nav.ts` (menu) and role checks in the API. Items the role cannot use are not shown. Unbuilt items would show greyed out with a "Soon" tag; there are none left in v1.

---

## 3. Information architecture and URLs

Every page lives under a language prefix. A request without one (e.g. `/login`) is redirected to the saved language, else the browser language, else Sinhala (`proxy.ts`).

```
/{lang}                         Landing (sign up / log in)
/{lang}/signup                  Create account
/{lang}/login                   Log in
/{lang}/privacy                 Privacy notice
/{lang}/app                     Entry after login: last institute, the only one, or onboarding
/{lang}/onboarding              Create an institute
/{lang}/join/{code}             Accept a staff or parent/student invite

/{lang}/t/{tenantId}                         Overview (staff) or Portal (parent/student)
  /scan                                      Scan attendance
  /students                                  Student list
  /students/new                              Add student
  /students/import                           CSV import
  /students/{studentId}                      Student detail (classes, fees, card, portal link, edit)
  /students/{studentId}/card                 Print one QR card
  /classes                                   Class list
  /classes/new                               New class
  /classes/{batchId}                         Class detail (link, fees, schedule, students, next classes)
  /classes/{batchId}/cards                   Print all QR cards of a class
  /timetable                                 Week view
  /attendance                                Classes of a day
  /attendance/{sessionId}                    Class register
  /fees                                      Month view: totals, create invoices, not-paid list
  /payments/{paymentId}                      Printable receipt
  /slips                                     Bank slip review
  /reports                                   Reports and CSV downloads
  /settings                                  Staff, invites, plan
```

`{lang}` is `si`, `ta` or `en`. `{tenantId}` is the institute id; switching institute changes only this part.

---

## 4. App shell and navigation

All `/t/{tenantId}` pages share one shell (`components/dashboard-shell.tsx`).

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Menu] [Institute ▾]                        [සිංහල ▾] Nimal  Log out │  header, white, bottom border
├──────────────┬───────────────────────────────────────────────────────┤
│ Overview     │                                                       │
│ Scan         │   Page content                                        │
│ Students     │   (padding 16px phone / 32px desktop,                 │
│ …            │    most pages capped at max-w-3xl/4xl)                │
│ Settings     │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
  sidebar 240px, desktop only
```

- **Institute switcher**: a native select in the header listing the user's institutes, plus "+ New institute". The last used institute is remembered in the browser and opened after login.
- **Active item**: light indigo background, indigo text, `aria-current="page"`. A section stays active on its sub-pages (e.g. Students on a student page).
- **Phone (< 768px)**: sidebar hidden; a "Menu" button opens a full-screen menu under the header with the language switcher at the bottom. Choosing an item closes it. The user's name and the header language switcher are hidden below 640px.
- **Loading**: until the session and institute are loaded the whole area shows "Loading…".
- **Not logged in / not a member**: 401 goes to Login; an institute the user does not belong to goes to `/app`.
- **Printing**: header and sidebar are hidden (`print:hidden`) so receipts and cards print alone.

Pages outside the shell (landing, login, signup, join, onboarding, privacy) are a single centred column with the language switcher under or beside the form.

---

## 5. Visual design

There is no separate design-token file yet; the system is Tailwind's default palette used consistently. These are the values in use.

### 5.1 Colour

| Use | Colour (Tailwind) |
|---|---|
| Page background | `#f8fafc` (slate-50) |
| Text | `#18181b` (zinc-900); secondary `zinc-500/600/700` |
| Surfaces | white cards with `border-zinc-200` |
| Primary action | `indigo-600`, hover `indigo-700`; links `indigo-600` |
| Focus | `border-indigo-600` + `ring-2 ring-indigo-200` |
| WhatsApp / approve / join | `green-600` button, white text |
| Success / present / paid | `green-50…700` |
| Late | `orange-500` (register buttons), `orange-50` (scan result) |
| Warning / part paid / pending / duplicate scan | `amber-50…900` |
| Error / unpaid / absent / reject | `red-50…800`, solid `red-600` for absent |
| Disabled / void / "Soon" | `zinc-100…400` |

Status colours are fixed across the app:

| Meaning | Badge / panel |
|---|---|
| Present | green |
| Late | orange |
| Absent | red |
| Invoice unpaid | red-50 / red-700 |
| Part paid | amber-50 / amber-800 |
| Paid | green-50 / green-700 |
| Void | zinc-100 / zinc-500 |
| Slip waiting for check | amber-700 text |
| Slip rejected | red-700 text |

### 5.2 Typography

- **Fonts**: Noto Sans (Latin), Noto Sans Sinhala, Noto Sans Tamil, loaded with `next/font`. The stack is Latin → Sinhala → Tamil, so each script uses its own Noto face and only downloads when that script appears.
- **Scale**: page title `text-2xl font-semibold`; section title `font-medium` (base size); body `text-sm`/`text-base`; hints `text-xs zinc-500`; scan result name `text-2xl`.
- **Numbers**: money, times, student numbers and receipt numbers use `font-mono` so columns line up.
- Form inputs use `text-base` (16px) so iPhones do not zoom on focus.

### 5.3 Shape and spacing

- Radius: inputs/buttons `rounded-lg`, sections `rounded-xl`, auth cards and scan result `rounded-2xl`.
- Borders are 1px `zinc-200`; shadows only on the auth card (`shadow-sm`).
- Section padding `p-4`; vertical rhythm `space-y-4`/`space-y-6`; lists use `divide-y divide-zinc-100`.
- Content widths: forms `max-w-sm`/`max-w-xl`, most pages `max-w-3xl`, slips and reports `max-w-4xl`.

### 5.4 Icons and imagery

None. The UI uses words only (plus `←`/`→` in back links and week navigation). Slip photos and QR codes are the only images.

---

## 6. Components

Shared primitives live in `components/ui.tsx`; everything else is page-level Tailwind.

| Component | Look and behaviour |
|---|---|
| `Field` | Label above (`text-sm font-medium`), full-width input, optional hint below linked with `aria-describedby`. |
| `Button` | Full-width primary button (indigo). `busy` disables it to stop double submits. |
| `FormError` | Red-50 box with `role="alert"`; shows the translated API error. |
| `Card` | Centred white card, `max-w-sm`, used by login, signup, join, onboarding. |
| `Spinner` | Text "Loading…" with `role="status"` (no animation). |
| `LanguageSwitcher` | Native select showing සිංහල / தமிழ் / English; stores the choice in a cookie for a year and swaps the URL prefix. |
| Secondary button | `rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm` (Print, Previous week, Create link…). |
| WhatsApp button | `rounded-lg bg-green-600 text-white` link that opens `https://wa.me/94…?text=…` in a new tab. |
| Section | `rounded-xl border border-zinc-200 bg-white p-4` with a `font-medium` heading. |
| List | `ul` inside a section, `divide-y`, rows `px-4 py-2/3`. |
| Status badge | `rounded px-2 text-xs` with the status colours above. |
| Empty state | grey text; the timetable uses a dashed-border box. |
| Data table (reports) | white bordered table, grey header row, numbers right-aligned in mono, horizontal scroll inside the table on phones. |

---

## 7. Interaction patterns

**Loading and errors**
- Data loads in the browser after the page opens; the area shows "Loading…" until then.
- API errors are translated by error code (`errors.*` in the dictionaries) and shown in a `FormError` near the action.
- "Missing" and "not yours" look the same (404) so ids from another institute cannot be probed.

**Forms**
- Native inputs: `type="tel"` for mobiles, `type="date"`, `type="time"`, `type="month"`, `type="url"`, `type="file"` with `accept`. No custom pickers.
- Mobile numbers are typed in any common format (`0771234567`, `+94 77…`) and shown as `077 123 4567`.
- Search (students) waits ~250 ms after typing before calling the API.
- The institute "link name" fills itself from the name until the user edits it.

**Duplicates and safety**
- Adding a student with the same name and phone shows "Is this the same student?" with **Open existing** and **Add anyway**.
- Payments and slip uploads carry a one-time id from the browser: a double tap records once.
- A second scan of the same card in the same class shows "Already marked" in amber; nothing changes.
- Destructive actions use a two-step button (e.g. **Replace lost card** → **Confirm: old card stops working** in red). Rejecting a slip needs a reason first.
- Limits (Free plan's 50 students) are refused with a message that points to Settings → Plan; nothing is deleted.

**WhatsApp messages**
The app never sends messages itself. Each place builds the text in the user's language and opens WhatsApp with the parent's number:

| Where | Message |
|---|---|
| After a scan | "{student} attended {class} today at {time}." (or "arrived late") |
| Fees month, not-paid list | Fee reminder with month, amount and due date |
| Receipt / after approving a slip | "Payment received: LKR {amount} for {student} (receipt {number})." |
| Staff invite | Invite link for the role |
| Parent/student invite | Link to see classes, attendance and fees |

**Money**: shown as `LKR 2,500.00` / `2,500.00` with mono digits; typed as plain numbers; never rounded through floating point.
**Dates and times**: Sri Lanka time; day and month names come from our dictionaries (browsers show Sinhala/Tamil dates unreliably), e.g. "සෙනසුරාදා 17 ඔක්".

---

## 8. Screens

### 8.1 Public and account

| Screen | Layout | Notes |
|---|---|---|
| **Landing** `/` | Header with app name + language; centred headline "Run your tuition class without the paperwork", subline, two buttons (Create free account, Log in). | Mentions free for 50 students. |
| **Sign up** | Card: name, mobile, password (hint "At least 8 characters"), required checkbox "I have read and agree to the Privacy notice" (opens in a new tab), Create account. Link to log in. | Consent time is stored. |
| **Log in** | Card: mobile, password, Log in. Link to sign up. | Wrong mobile and wrong password give the same message. |
| **Privacy notice** | Simple text page: what we keep, why, who can see it, children, how long, your rights. | si/ta/en. |
| **Onboarding** | Card: institute name, link name (auto-filled), Create. | Creates the institute with the user as owner. |
| **Join invite** | Title "You are invited", "{institute} invited {name} to join as {role}". Not logged in: sign-up form with the mobile pre-filled and locked (switch to log in in place). Logged in with the right mobile: **Accept invite**. Wrong mobile: explanation + Log out. | Used for staff and parents/students. Expired or used links show a clear message. |

### 8.2 Overview (staff)

Welcome line with the user's name, two small cards (Institute, Your role), and a line pointing to the menu. Intentionally light; a real dashboard (today's classes, money in today, slips waiting) is a gap ([§11](#11-known-gaps-and-inconsistencies)).

### 8.3 Scan (desk)

Built for speed with a USB scanner or a phone camera.

- One large input (`text-lg`, thick indigo border) with autofocus: "Scan card or type student number". A scanner types the code and Enter.
- **Use camera** button: Android/desktop Chrome camera scanning (BarcodeDetector). On browsers without it, an amber note suggests a USB scanner or typing the number (iPhone Safari today).
- **Result panel** (large, rounded, coloured by outcome): green present, orange late, amber already marked, red error. Shows the student name large, number · class · status.
  - If fees are due: a red strip "Fees due: LKR …".
  - One green **WhatsApp {parent}** button per guardian with the attendance message ready.
- **Recent scans** list below: time, name, class.
- The class is chosen automatically: the class running now (opens 60 minutes before start); late after 15 minutes.

### 8.4 Students

- **List**: search box (name, number or parent phone), "Show inactive" toggle, Add student, Import CSV. Rows: mono student number, name, grade, parent phone. "Load more" paging. Empty and no-results texts.
- **Add / edit**: name, grade, school, student mobile (optional), parent block (name, mobile, relationship) with "+ Add second parent", notes, status. Duplicate warning as in §7.
- **Import CSV**: help text with the columns, Download template, choose file, **Check file** (preview: ready / skipped / problems with line numbers), then **Import {count} students**. All or nothing.
- **Detail** (one page, top to bottom):
  1. Title: mono number + name; back link.
  2. Classes: chips of the student's classes + "Add to class".
  3. Fees: outstanding badge, take payment (amount, method), concessions (free card, half card, %), invoices with lines and status badges, payments with receipt links.
  4. Card: Print card / Replace lost card (two-step).
  5. Parent / student app (desk staff, active students): one row per known mobile (student and guardians) → **Create link** → green **Send on WhatsApp**.
  6. Edit form.

### 8.5 Classes and timetable

- **Class list**: two-column card grid (one on phones): name, subject · teacher · mode, student count, weekly times. "Show archived" toggle, New class.
- **New class**: name, subject (pick or type new), teacher, mode (physical / online / hybrid).
- **Class detail**: title + subject · teacher · mode; Archive / Make active. Sections:
  - Live class link (owners/admins edit, teachers see the link): https-only URL field with the rule explained under it.
  - Monthly fees: class, AC, tute fee inputs + Save fees.
  - Weekly schedule: list (day, time, room, Remove) + add row (day, start, end, starts on, room).
  - Students in this class: list with Remove + search to add.
  - Next classes: with cancel / restore / move actions.
  - Print class cards.
- **Timetable**: week view grouped by day (one section per day with classes). Row: mono time range, class link, subject · teacher · room · "Extra class" · note. Cancelled classes are struck through. Previous / This week / Next buttons. Teachers can cancel, restore or move their own classes from here.
- **Class cards print**: bank-card sized cards (85.6 × 54 mm) in a grid that fits A4 two across. Each card: large QR (44 mm), name, number, institute. Hint: print on A4 and cut, or "Save as PDF".

### 8.6 Attendance

- **Day view**: date picker; list of that day's classes with present / late / absent / not marked counts and **Open register**.
- **Register**: one row per enrolled student with three toggle buttons (Present green, Late orange, Absent red; unselected are white outlined). Changes are saved per tap and recorded in an audit trail. Teachers only see their own classes.

### 8.7 Fees and payments

- **Fees month**: month picker; three totals (Billed, Collected, Outstanding); **Create invoices for this month** (safe to run again; shows "N invoices created, M lines added"); **Not paid** list with name, balance, due date and a green **Remind** WhatsApp button per parent. "Everyone has paid" when empty.
- **Take payment** (on the student page): amount (pre-filled with what is due), method (cash / bank transfer), reference; paid oldest invoice first; overpayment refused with the outstanding amount.
- **Receipt**: narrow printable page (`max-w-md`): institute name, receipt number, date, student, method, received by, "Paid for" table of invoices and amounts, total. Buttons: back, Print, green **Send receipt on WhatsApp**.

### 8.8 Bank slips (desk)

- Tabs as buttons: **Waiting for check** / **Verified** / **Rejected** (selected tab solid indigo).
- One card per slip: photo thumbnail on the left (click opens full size; PDFs show a "PDF" tile), on the right:
  - student (link), amount and bank reference, submitted date/time, who sent it and their mobile;
  - red warnings: "Same photo was uploaded before", "Same bank reference was used before";
  - outstanding for the student;
  - **Amount** field (correct a typo) + green **Verify + receipt**;
  - reason field + **Reject** (disabled until a reason is typed).
- After verifying, the card turns green with the receipt number, **Send receipt on WhatsApp** and **Done** (reloads the list).
- Verified tab shows the receipt link; Rejected tab shows the reason.

### 8.9 Reports (owner/admin)

- From / To month pickers (default: January of this year to this month; maximum 24 months).
- Tables: **Fees by month** (invoices, billed, collected, outstanding), **Money received** (month, method, payments, amount), **Daily collection** (collapsible), **Attendance by class** (classes held, students, present, late, absent, rate %).
- **Download for Excel (CSV)**: Payments (range), Unpaid fees, Students. Files open correctly in Excel with Sinhala/Tamil text.

### 8.10 Settings (owner/admin)

- **Staff**: list (name, mobile · role, "(you)"), Remove for others (not the owner).
- **Invite staff**: name, mobile, role → pending invites list with **Send on WhatsApp**, Copy link, Revoke, expiry date.
- **Plan**: "Plan: Free", "4 of 50 active students" with a progress bar (red when full), paid-until or ended date, and how to upgrade (prices; pay by bank transfer and send the slip on WhatsApp).

### 8.11 Parent / student portal

The whole parent experience is the Overview page. One block per child linked to the account:

```
Kasun Perera  1001
┌ Fees ───────────────────────────────────────────┐
│ Outstanding: LKR 1,800.00            (or "All fees are paid.")
│ Oct 2026   Due 2026-10-05                1,800.00
│ 2026-10-17 · LKR 1,800.00 · Waiting for check   (slip status)
│ [Paid at the bank? Send the slip]
│ Recent payments
│ 2026-10-17 · Receipt No. 1               1,000.00
└─────────────────────────────────────────────────┘
┌ Next classes ───────────────────────────────────┐
│ Saturday 17 Oct · 14:00–17:00 · 2027 A/L Theory [Join live class]
│ Sunday 18 Oct · 09:00–12:00 · … (link opens 30 min before class)
│ Classes: 2027 A/L Theory (Combined Maths)
└─────────────────────────────────────────────────┘
┌ Recent attendance ──────────────────────────────┐
│ Saturday 17 Oct · 2027 A/L Theory      [Present]
└─────────────────────────────────────────────────┘
```

- **Send the slip** opens an inline form: photo/PDF picker (camera on phones), amount (pre-filled with what is due), bank reference, **Send slip**. Photos are shrunk in the browser before upload.
- **Join live class** (green) appears only from 30 minutes before the class until it ends, and only if that month is paid; otherwise "(pay this month's fee to join)" in red or "(link opens 30 min before class)" in grey.
- Cancelled classes are struck through with "(cancelled)".
- No children linked yet: a short message asking the institute for a new link.

---

## 9. Key flows end to end

**A. New teacher, first day**
Landing → Create free account (consent) → Create institute → Overview → Classes → New class → add weekly time and fees → Students → Import CSV or Add → class detail → add students → Print class cards → Scan.

**B. Class day at the desk**
Scan card → green panel (or amber "already", red error, red "fees due") → optional **WhatsApp parent** → student pays cash: open student → Take payment → Receipt → Print or **Send receipt on WhatsApp**.

**C. Parent joins and pays by bank**
Desk: student page → Parent / student app → Create link → Send on WhatsApp.
Parent: opens link → creates account with the same mobile (consent) → Accept invite → portal → **Send the slip** (photo, amount) → "Waiting for check".
Desk: Bank slips → check photo and warnings → **Verify + receipt** → **Send receipt on WhatsApp**.
Parent: portal shows "All fees are paid" and the live class **Join** button around class time.

**D. Month end**
Fees → pick month → **Create invoices for this month** → Not paid list → **Remind** each parent on WhatsApp → Reports → Download CSV.

**E. Staff invite**
Settings → Invite staff (name, mobile, role) → Send on WhatsApp → staff opens link → signs up with that mobile → Accept → lands in the institute with their role's menu.

---

## 10. Language, responsiveness, printing and accessibility

**Language**
- Three complete dictionaries: `i18n/dictionaries/{si,ta,en}.ts`; TypeScript fails the build if a key is missing in one language.
- Choice order: saved cookie → browser language → Sinhala. The switcher keeps the user on the same page.
- WhatsApp messages, receipts and the privacy notice follow the chosen language.
- Native browser controls (date/month pickers, file picker) follow the device language, not ours.

**Responsive**
- Breakpoints: `sm` 640px (shows header name/language, two-column grids), `md` 768px (sidebar instead of Menu button).
- Rows use `flex-wrap` so actions drop under the text on phones; tables in Reports scroll inside their box.
- Checked in the browser at desktop and phone widths for each released slice.

**Printing**
- Receipt and class cards are print layouts; header, sidebar and buttons are hidden when printing. "Save as PDF" in the print dialog gives a PDF (no server PDF generation).

**Accessibility (what is in place)**
- `html lang` set per language; labels tied to inputs; hints linked with `aria-describedby`.
- Errors use `role="alert"`, results and loading use `role="status"` (screen readers announce scan results).
- Current menu item has `aria-current="page"`; the mobile menu button has `aria-expanded`.
- Status is never colour-only: badges and panels always include the word (Present, Late, Unpaid…).
- 16px inputs; buttons are real `<button>`s; links are real `<a>`s.

---

## 11. Known gaps and inconsistencies

| Area | Gap | Suggested fix |
|---|---|---|
| Staff overview | Only a welcome message; no daily summary. | Today's classes, money received today, slips waiting, not-paid count, with links. |
| Design tokens | Colours and sizes are repeated Tailwind classes; no shared tokens. | Move colours to `@theme` tokens (primary, success, warning, danger, surface) and reuse them. |
| Buttons | `Button` is always full width, so most pages hand-write button classes; several slightly different secondary buttons exist. | Add size/variant props (primary, secondary, danger, whatsapp; full or auto width). |
| Feedback | No toasts; success messages are inline text in different styles. | One inline success style, or a small toast for saves. |
| Loading | "Loading…" text only; no skeletons; whole page waits for the shell. | Skeleton rows for lists; keep the shell visible while a page loads. |
| Confirmations | Only card replacement and slip reject are two-step; removing a student from a class or revoking an invite is one tap. | Same two-step pattern for every removal. |
| Teachers | Teachers have no Students menu item (they reach students through their classes). | Add a Students view filtered to their classes. |
| iPhone | Camera scanning not supported in Safari. | Add a JS QR decoder fallback. |
| Native pickers | Month/date pickers show the device language (often English). | Acceptable for v1; custom pickers only if users struggle. |
| Dark mode | None; light only. | Not planned for v1. |
| Icons | None. | Optional: a small icon set for the menu and status. |
| Portal | One long page; no notifications (web push deferred). | Keep single page; add push for slip approved/rejected and class changes. |
| Password reset | No "Forgot password" link (email reset not built yet). | Add with Gmail SMTP (v1 scope). |
| Upgrade | Plan card says "send us the slip on WhatsApp" without a number. | Add the support WhatsApp number. |
| Language review | Sinhala and Tamil text written without native-speaker review. | Review with pilot users. |

---

## 12. Rules for new screens

1. Put every string in all three dictionaries; no hard-coded text.
2. Start at phone width; no sideways scrolling; wrap actions under content.
3. Use the shell, a `text-2xl font-semibold` page title, and white `rounded-xl` sections.
4. Use the fixed status colours from §5.1 and always show the status word.
5. Money with `fmtMoney` (mono, two decimals); times with the Sri Lanka helpers in `lib/datetime.ts`.
6. Messages to parents: build the text from the dictionary and open WhatsApp with `waLink`; never send silently.
7. Every create/pay/upload action must survive a double tap (disable while busy and send a one-time id).
8. Removals and money-changing actions need a second confirming tap.
9. Show API errors with `FormError` using the translated error code.
10. If it prints, hide the shell (`print:hidden`) and size it in mm.
