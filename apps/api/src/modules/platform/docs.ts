// Platform documentation shown in the console at /admin/docs (platform admins only: it is served
// by GET /api/v1/admin/docs, so it never ships in the public web bundle). Plain data, rendered by
// apps/web/src/components/admin/docs.tsx. Inline text supports `code`, **bold** and [links](/path);
// a link to "docs:<slug>" opens another page. English only for now.

export type Block =
  | { h2: string }
  | { h3: string }
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { code: string; title?: string }
  | { note: string; tone?: 'info' | 'warning' | 'danger' };
export interface DocPage {
  slug: string;
  group: string;
  title: string;
  summary: string;
  blocks: Block[];
}

export const DOCS: DocPage[] = [
  // ---------------------------------------------------------------- Getting started
  {
    slug: 'overview',
    group: 'Getting started',
    title: 'Overview',
    summary: 'What the platform console is for, and the five ideas everything else builds on.',
    blocks: [
      {
        p: 'Tuition LMS bills its customers **per head, per month**: the highest number of active students, teachers and parents an account had during the month, times a unit price. The platform console at `/admin` is where you run that business: customers, prices, trials, invoices, payments and suspension.',
      },
      {
        note: 'The console shows metadata only: names, owner mobiles, counts, prices and money. It never shows students, guardians, attendance or fee records.',
      },
      { h2: 'Core concepts' },
      {
        table: {
          head: ['Concept', 'What it is'],
          rows: [
            [
              '**Account**',
              'A paying customer: owner mobile, price book, trial end, suspension, notes. Owns 1 to n institutes.',
            ],
            [
              '**Institute**',
              'Where the work happens (students, classes, fees). Each one is isolated from every other by the database. Billing never reads inside an institute except for head counts.',
            ],
            [
              '**Price book**',
              'A named set of values: prices per head, free allowances, minimum charge, caps and feature switches. `standard` is the default for new sign-ups.',
            ],
            [
              '**Override**',
              'A value for one account and one key, optionally expiring, with a note. Wins over the price book.',
            ],
            [
              '**Head**',
              '`student` (active student records), `teacher`, `parent`, `admin`, `receptionist` (active members with that role). Owner and student logins are never billed.',
            ],
            [
              '**Invoice**',
              'One per account per finished month: lines of head × peak × unit price, minus allowances, plus a minimum top-up. `open`, `paid` or `void`.',
            ],
          ],
        },
      },
      { h2: 'The monthly cycle' },
      {
        steps: [
          'All month, database triggers record each institute’s head counts per day.',
          'On the 1st, open **Invoices**, pick last month, **Check totals**, then **Generate**. It is safe to click twice.',
          'Customers see the invoice on their **Billing** page, pay by bank transfer and send the slip on WhatsApp.',
          'You **Record payment** on the invoice. The account goes back to `active` at once.',
          'Unpaid 7 days after the due date (`grace_days`), the account is `restricted`: no new people, everything else works.',
          'Still unpaid after reminders: **Suspend** makes it read-only.',
        ],
      },
      { h2: 'Where to go next' },
      {
        list: [
          '[Account states](docs:account-states): what each state allows.',
          '[Price books](docs:price-books) and [Overrides](docs:overrides): setting prices.',
          '[Monthly invoices](docs:invoices): the 1st-of-the-month routine.',
        ],
      },
    ],
  },
  {
    slug: 'access',
    group: 'Getting started',
    title: 'Access and security',
    summary: 'Who can use the console, how it hides itself, and how every change is recorded.',
    blocks: [
      {
        table: {
          head: ['Rule', 'How it works'],
          rows: [
            [
              'Who',
              'One platform owner: the single user with `users.is_platform_admin = true` (a unique index allows only one). They log in at `/admin/login` (`POST /api/v1/admin/auth/login`) with a separate `console_sid` cookie that is sent only to `/api/v1/admin`. The app login refuses them, and their session does nothing in any institute.',
            ],
            [
              'Hidden',
              'Every `/api/v1/admin/*` route, including these docs, answers **404** to anyone else, exactly like an unknown URL.',
            ],
            [
              'Fresh login',
              'Console sessions last **12 hours**. Older logins get `401 reauth_required` and the console asks you to log in again.',
            ],
            [
              'Rate limit',
              'Changes: 30 per minute per IP. Reads are not limited. The 404 check runs first, so non-admins never see a 429.',
            ],
            [
              'Audit',
              'Every change writes one `platform_audit` row (who, account, before, after, IP) in the same transaction. The app role cannot update or delete audit rows.',
            ],
          ],
        },
      },
      { h2: 'Setting the platform owner' },
      {
        p: 'Use a dedicated email that owns no institute: sign it up on the normal signup page (it needs no institute), then on the server, as the database owner:',
      },
      {
        code: "UPDATE users SET is_platform_admin = (lower(email) = 'console@example.com');",
        title: 'SQL (tuition_lms, owner role)',
      },
      {
        p: 'This also unflags any previous owner. Then log in at `/{lang}/admin/login`. That email can no longer use the institute app.',
      },
      {
        note: 'There is exactly one platform owner. Adding more admins waits for 2FA (SAAS_PLAN §14 decision 8).',
        tone: 'warning',
      },
    ],
  },

  // ---------------------------------------------------------------- Customers
  {
    slug: 'accounts',
    group: 'Customers',
    title: 'Accounts',
    summary: 'Creating customers, how they claim their account, and the accounts list.',
    blocks: [
      { h2: 'How accounts are created' },
      {
        table: {
          head: ['Path', 'What happens'],
          rows: [
            [
              'Created in the console',
              '**Accounts → New account**: name, owner email, optional owner mobile (contact only), price book, trial days (0 = none). The owner is emailed a link to create their login. With a trial, the `trial_caps` overrides are added (expiring with the trial). This is the only way to get a new customer: sign-up alone cannot create an institute.',
            ],
            [
              'Existing institutes (migration 013)',
              'One account per owner, `standard` book, at least 30 days free (or until their old paid date, if later), no caps.',
            ],
          ],
        },
      },
      { h2: 'Claiming by email' },
      {
        p: 'When someone creates an institute, the API looks for, in order: the account they already own; an **unclaimed** account whose owner email matches their **verified** login email (it becomes theirs); for accounts made before email login (no owner email), one whose owner mobile matches theirs; otherwise it is refused with `403 no_account`. Signing up proves the email with a 6-digit code, so only the person who reads that inbox can claim the account.',
      },
      {
        note: 'An email that already has an account is refused with `409 account_exists`. The list shows "Not signed up yet" until the account is claimed; **Resend invitation** emails the owner again.',
      },
      {
        p: 'The accounts list also shows how many users still log in by phone (no verified email yet). When it reaches 0, phone login can be removed (docs/EMAIL_AUTH_PLAN.md §9).',
      },
      { h2: 'The accounts list' },
      {
        list: [
          'Search by account name, owner email or owner mobile (0771234567 and 94771234567 both match).',
          'Filters: **Trial ending in 7 days**, **Overdue**, **Restricted**, **Suspended**.',
          'Columns: state, heads now (latest count per head), this month’s estimate, amount due.',
          '**Remind** opens WhatsApp with a reminder in the console’s language: the amount due, or the trial days left.',
        ],
      },
      { h2: 'Account page' },
      {
        p: 'State and dates; name, notes (only admins see them) and price book; **Prices, caps and features** with overrides highlighted; **Heads per day this month** with **Recount today**; institutes; invoices with **Record payment** and **Void**; payments; history (the last 100 audit rows).',
      },
    ],
  },
  {
    slug: 'account-states',
    group: 'Customers',
    title: 'Account states',
    summary:
      'Trial, active, overdue, restricted and suspended: how they are derived and what each one blocks.',
    blocks: [
      {
        p: 'There is no status column. The state is worked out on every request from facts (trial end, unpaid invoices, suspension), so it is never out of date. The **first** matching rule wins:',
      },
      {
        table: {
          head: ['#', 'When', 'State', 'New people?', 'Customer banner'],
          rows: [
            ['1', '`suspended_at` is set', '`suspended`', 'No, and **every** write refused', 'Red'],
            [
              '2',
              '`trial_ends_at` is in the future',
              '`trial`',
              'Yes, within trial caps',
              'Blue, days left',
            ],
            [
              '3',
              'An unpaid invoice is past due date + `grace_days`',
              '`restricted`',
              '**No.** Everything else works',
              'Red, pay to add more',
            ],
            [
              '4',
              'An unpaid invoice is past its due date',
              '`overdue`',
              'Yes',
              'Amber, amount and date',
            ],
            ['5', 'Otherwise', '`active`', 'Yes', 'None'],
          ],
        },
      },
      { h2: 'What restricted blocks' },
      {
        p: 'Only new billable heads: new or re-activated students (including CSV import), staff invites (sending and accepting), parents accepting a portal invite, and new institutes. Fee collection, receipts, attendance, classes, reports and the Billing page all keep working: that is how the customer earns the money to pay.',
      },
      { h2: 'What suspended blocks' },
      {
        p: 'The account becomes read-only. Every `POST`, `PUT`, `PATCH` and `DELETE` under `/tenants/:tenantId` returns `403 account_suspended`, with no exceptions, as do creating an institute and accepting an invite. Reading every page, the Billing page and every CSV export still work, so a suspended owner can still pay (bank transfer) and take their data.',
      },
      {
        table: {
          head: ['Who', 'Restricted', 'Suspended'],
          rows: [
            ['Owner, admin', 'Banner with link to Billing; cannot add people', 'Read-only'],
            ['Teacher, receptionist', 'Banner; cannot add people', 'Read-only'],
            [
              'Parent, student',
              'Nothing changes',
              'Can view the portal; cannot upload slips; sees a "paused" banner',
            ],
          ],
        },
      },
      {
        note: 'Recording a payment that clears the invoice moves the account straight back to `active`. Unsuspending is immediate.',
      },
    ],
  },
  {
    slug: 'trials',
    group: 'Customers',
    title: 'Trials',
    summary: 'Trial length, trial caps, extending a trial, and how trial days are billed.',
    blocks: [
      {
        list: [
          'Length for new sign-ups: setting `trial_days` (default 30).',
          'Caps during the trial: setting `trial_caps` (default `{"cap.students": 100, "cap.teachers": 5, "cap.institutes": 1}`). They are written as overrides that **expire with the trial**.',
          'Trial days are never billed: an invoice only counts days after the trial’s last Sri Lanka day.',
        ],
      },
      { h2: 'Extend or restart' },
      {
        p: 'Account page → **Extend trial** → days. A running trial is extended from its end date and the trial caps move with it. An ended trial restarts from today, without caps.',
      },
      {
        code: `// Trial ends at 20:00 on 10 September (Sri Lanka). Usage that month:
//   1–10 Sep: 80 students    11–30 Sep: 30 students
// September invoice: peak after the trial = 30 → 30 × LKR 100 = LKR 3,000.00`,
        title: 'Example',
      },
    ],
  },

  // ---------------------------------------------------------------- Pricing
  {
    slug: 'price-books',
    group: 'Pricing',
    title: 'Price books',
    summary: 'The catalogue of keys, editing a book, and creating books for groups of customers.',
    blocks: [
      {
        p: 'A price book is a set of values for catalogue keys. The keys live in code (because code enforces them); the values are data you edit without a deploy.',
      },
      {
        table: {
          head: ['Key', 'Kind', 'Meaning', '`standard`'],
          rows: [
            ['`price.student`', 'LKR / head / month', 'Active student records', '100'],
            ['`price.teacher`', 'LKR', 'Active teachers', '2,000'],
            ['`price.parent`', 'LKR', 'Active parents (portal users)', '50'],
            ['`price.admin`, `price.receptionist`', 'LKR', 'Active admins, receptionists', '0'],
            ['`included.<head>`', 'count', 'First N of that head free each month', '0'],
            ['`minimum.monthly`', 'LKR', 'Invoice is at least this, if above 0', '0'],
            [
              '`cap.students`, `cap.teachers`, `cap.parents`',
              'count or blank',
              'Refuse new heads beyond this; blank = no limit',
              'blank',
            ],
            ['`cap.institutes`', 'count or blank', 'Institutes per account', '3'],
            ['`feature.<name>`', 'on / off', 'See [Features](docs:features)', 'on'],
          ],
        },
      },
      { h2: 'Editing' },
      {
        list: [
          '**Price books** shows books × keys. **Save** first shows how many accounts use the book; click again to save.',
          'Changes apply from the **next** invoice. Past invoices keep the prices they were made with.',
          'Prices have at most 2 decimals; counts are whole numbers. Unknown keys and bad values are refused.',
          'A key missing from a book and from overrides means: price 0, no cap, feature **off**.',
        ],
      },
      { h2: 'New books' },
      {
        p: '**New price book** (key `a-z 0-9 - _`, e.g. `ngo`, `pilot`) starts as a copy of the default book. Move an account to it with **Price book** on the account page.',
      },
    ],
  },
  {
    slug: 'overrides',
    group: 'Pricing',
    title: 'Overrides',
    summary: 'One customer’s own price, cap or feature, optionally until a date.',
    blocks: [
      {
        p: 'Account page → **Set override**: key, value, optional expiry date and a note saying why (required). The override wins over the price book until it expires; **Remove** goes back to the book.',
      },
      {
        table: {
          head: ['Need', 'Key', 'Value'],
          rows: [
            ['Students at LKR 80 until March', '`price.student`', '`80`, expires 31 March'],
            ['First 20 students free', '`included.student`', '`20`'],
            ['A 4th institute', '`cap.institutes`', '`4`'],
            ['No student cap', '`cap.students`', 'blank'],
            ['Parent app off', '`feature.portal`', 'Off'],
            ['At least LKR 5,000 a month', '`minimum.monthly`', '`5000`'],
          ],
        },
      },
      {
        note: 'An expiry must be in the future (`400 expiry_in_past`). Overrides that expire with a running trial move when you extend the trial.',
      },
    ],
  },
  {
    slug: 'features',
    group: 'Pricing',
    title: 'Features and caps',
    summary: 'What switching a feature off does, and exactly where caps are checked.',
    blocks: [
      {
        p: 'A feature that is off shows a lock on the customer’s menu item and a "not included in your plan" card on the page. The server refuses with `403 feature_locked { feature }`. Nothing is deleted; switching it on restores everything.',
      },
      {
        table: {
          head: ['Feature', 'When off'],
          rows: [
            ['`feature.reports`', 'Reports page and every CSV download refused'],
            [
              '`feature.student_import`',
              'CSV import refused; adding students one by one still works',
            ],
            [
              '`feature.bank_slips`',
              'Parents cannot upload slips; the desk’s Bank slips queue is locked. Pending slips stay pending and come back when it is on again',
            ],
            [
              '`feature.live_links`',
              'A link cannot be set (clearing one is allowed). Links already set are kept but hidden from parents and students',
            ],
            [
              '`feature.portal`',
              'New parent/student invites cannot be sent or accepted. Families already in keep their access',
            ],
          ],
        },
      },
      { h2: 'Where caps are checked' },
      {
        table: {
          head: ['Head', 'Checked when'],
          rows: [
            [
              'Student',
              'Add, re-activate, CSV import (the whole file is refused if it would go over)',
            ],
            [
              'Teacher',
              'Staff invite sent (early refusal) and accepted (the check that holds). Pending invites do not count',
            ],
            [
              'Parent',
              'Portal invite **accepted** only; sending is free. A parent of a second child is not a new head',
            ],
            ['Institute', 'Creating an institute'],
            ['Admin, receptionist', 'No cap key: only the restricted / suspended check'],
          ],
        },
      },
      {
        p: 'Caps count across all institutes of the account. Two desks adding the last place at the same moment cannot both succeed: the check holds a lock per account and cap until the change commits. The error is `403 plan_limit { key, limit, used }`.',
      },
    ],
  },

  // ---------------------------------------------------------------- Billing
  {
    slug: 'metering',
    group: 'Billing',
    title: 'Metering',
    summary: 'How head counts are recorded, peak counting, and the Recount action.',
    blocks: [
      {
        p: 'Head counts are recorded by **database triggers** on `students`, `membership_roles` and `tenant_memberships`, so no code path can forget them (the API, CSV import, the portal, raw SQL). After any change, the institute’s five head counts are recounted and today’s row in `tenant_usage_daily` is updated.',
      },
      {
        table: {
          head: ['Column', 'Meaning'],
          rows: [
            ['`day`', 'Sri Lanka (Asia/Colombo) date'],
            ['`count_max`', 'The day’s peak'],
            ['`count_last`', 'The latest count; days without a row carry it forward'],
          ],
        },
      },
      { h2: 'Peak billing' },
      {
        p: 'For each head, the invoice takes the highest **account-wide** total of any billed day in the month (summing the institutes day by day). Deactivating students before the month ends does not lower that month’s bill.',
      },
      { h2: 'Recount today' },
      {
        p: 'If an account’s counts look wrong, **Recount today** on the account page rewrites today’s rows from live counts for every institute of the account. It uses the triggers’ own function, so `count_last` becomes the live count and the day’s peak never goes down. Each recount is audited as `account.recount` with before and after.',
      },
      {
        note: 'Recount fixes a missed increase. A count that is too high can only be corrected by hand in the database.',
        tone: 'warning',
      },
    ],
  },
  {
    slug: 'invoices',
    group: 'Billing',
    title: 'Monthly invoices',
    summary: 'Generating invoices on the 1st, numbering, due dates, voiding and regenerating.',
    blocks: [
      { h2: 'On the 1st of each month' },
      {
        steps: [
          '**Invoices** → pick the month just finished → **Check totals**. This shows what Generate would create, account by account, without creating anything.',
          '**Generate invoices for <month>**. Each account gets one invoice.',
          'Customers see it on their Billing page at once.',
        ],
      },
      {
        list: [
          'Only a finished month can be invoiced (`400 invalid_period`).',
          'Idempotent: an account that already has a live invoice for the month is skipped, so clicking twice does nothing.',
          'Nothing to bill (trial all month, or total 0): no invoice.',
          'Numbers run per billed month: `S-2026-09-0001`, `S-2026-09-0002`, …',
          'Due date: generation day + `invoice_due_days` (default 7).',
          'Prices are read when generating, and each line stores its unit price. Later price changes never alter an invoice.',
        ],
      },
      { h2: 'How the total is worked out' },
      {
        code: `for each head h:
  peak(h)     = max over billed days of Σ institutes count(h)   (days after the trial)
  billable(h) = max(0, peak(h) − included(h))
  line(h)     = billable(h) × price(h)
total = max(Σ line(h), minimum.monthly)   (a top-up line shows the difference)`,
        title: 'computeInvoice',
      },
      {
        p: 'The customer’s Billing page and the console estimate use the same function with "month so far", so the estimate and the invoice cannot disagree.',
      },
      { h2: 'Fixing a wrong invoice' },
      {
        steps: [
          'On the account’s invoice: type a reason → **Void** → click again. Only an open invoice **without payments** can be voided.',
          'Fix the cause (override, price book, trial).',
          'Generate the month again on **Invoices**. The void invoice stays as a record; the account gets a new one with the next number. Other accounts are untouched.',
        ],
      },
      {
        note: 'An invoice with payments cannot be voided. Settle the difference with the customer and write it in the account notes until credit notes exist.',
        tone: 'warning',
      },
    ],
  },
  {
    slug: 'payments',
    group: 'Billing',
    title: 'Payments',
    summary: 'Recording bank transfers, part payments and safe retries.',
    blocks: [
      {
        steps: [
          'The customer pays by bank transfer and sends the slip on WhatsApp (the Billing page’s button carries the invoice number and amount).',
          'Check the money arrived in the bank.',
          'Account page → invoice → **Record payment**: amount and bank reference.',
        ],
      },
      {
        list: [
          'Part payments add up; the invoice becomes `paid` when they reach the total.',
          'A payment above what is still due is refused (`400 amount_exceeds_due`).',
          'Each payment carries a one-time `clientRef`: a retry or a double click records it once. The same `clientRef` on another invoice is refused (`409 client_ref_used`).',
          'A paid or void invoice takes no more payments (`409 invoice_not_open`).',
        ],
      },
    ],
  },
  {
    slug: 'customer-view',
    group: 'Billing',
    title: 'What customers see',
    summary: 'The Billing page, the account banner and the locks, from the customer’s side.',
    blocks: [
      { h2: 'Billing page (owners and admins)' },
      {
        list: [
          'State badge and, during a trial, days left; bars for each capped limit.',
          '**This month so far**: peak per head, unit price, amount and total (the same calculation as the invoice).',
          'Prices per month.',
          'Invoices (newest 24, void ones hidden) with paid and amount still due.',
          '**Send slip on WhatsApp** per unpaid invoice: opens WhatsApp to the support number with the invoice number, amount due and institute name.',
          '**How to pay**: the bank details text and support WhatsApp from Settings.',
        ],
      },
      {
        note: 'Fill in **Settings → Bank details** and **Support WhatsApp** before the first invoice. Without them the page says bank details are coming and shows no WhatsApp button.',
        tone: 'warning',
      },
      { h2: 'Account banner' },
      {
        table: {
          head: ['State', 'Staff see', 'Parents and students see'],
          rows: [
            ['Trial', 'Blue: days left', 'Nothing'],
            ['Overdue', 'Amber: invoice number, amount, due date', 'Nothing'],
            ['Restricted', 'Red: amount; new people blocked, everything else works', 'Nothing'],
            ['Suspended', 'Red: read-only, contact support', 'Red: paused, cannot upload slips'],
          ],
        },
      },
      {
        p: 'Owners and admins get a **View billing** link in the banner. Locked features show a lock on the menu item and a card on the page.',
      },
    ],
  },
  {
    slug: 'settings',
    group: 'Billing',
    title: 'Settings',
    summary: 'Platform-wide settings and their allowed values.',
    blocks: [
      {
        table: {
          head: ['Key', 'Allowed', 'Default', 'Used for'],
          rows: [
            ['`trial_days`', '1–365', '30', 'Trial length for new self sign-ups'],
            [
              '`grace_days`',
              '0–90',
              '7',
              'Days after the due date before an account is restricted',
            ],
            ['`invoice_due_days`', '0–90', '7', 'Due date = generation day + this'],
            [
              '`trial_caps`',
              '`cap.*` keys only',
              '100 students, 5 teachers, 1 institute',
              'Overrides given to new sign-ups, expiring with the trial',
            ],
            [
              '`support_whatsapp`',
              '`94XXXXXXXXX` or empty',
              'empty',
              'WhatsApp button on the Billing page',
            ],
            [
              '`bank_details`',
              'Text, up to 1000 characters, or empty',
              'empty',
              'How to pay, shown as written',
            ],
          ],
        },
      },
      { p: 'Each change is audited as `setting.update` with the old and new value.' },
    ],
  },

  // ---------------------------------------------------------------- Operations
  {
    slug: 'monthly-checklist',
    group: 'Operations',
    title: 'Monthly checklist',
    summary: 'The routine for the start of every month, and weekly checks.',
    blocks: [
      { h2: 'On the 1st' },
      {
        steps: [
          '**Invoices** → last month → **Check totals**. Look for anything surprising.',
          '**Generate**.',
          '**Accounts** → filter **Trial ending in 7 days** → **Remind** each one.',
        ],
      },
      { h2: 'Each week' },
      {
        steps: [
          'Check the bank; **Record payment** for each transfer (use the slip’s invoice number).',
          '**Accounts** → **Overdue** → **Remind**.',
          '**Restricted** for more than a few weeks after reminders: consider **Suspend** with a reason.',
        ],
      },
      { h2: 'Before the first real invoice' },
      {
        list: [
          'Prices checked with at least two pilot teachers.',
          '**Settings**: bank details and support WhatsApp filled in.',
        ],
      },
    ],
  },
  {
    slug: 'operations',
    group: 'Operations',
    title: 'Releases, migrations and backups',
    summary: 'How code reaches production, how migrations run, and where backups are.',
    blocks: [
      {
        code: `git checkout production && git merge --ff-only main && git push
  → GitHub Actions: format, lint, typecheck, migrate check, tests, build
  → images built → deploy.sh on the server: pull → migrate (owner role) → restart
  → smoke check https://lms.kwingsmedia.com/api/health`,
        title: 'Release',
      },
      {
        list: [
          'Migrations run automatically in the deploy, before the new version starts. A failing migration stops the deploy and the old version keeps running.',
          'Migrations are expand-first: a column is dropped only after the code that read it has been live for a release. `016_drop_tenant_plan` waits on the branch `saas-phase5-drop-tenant-plan` for that reason.',
          'Backups: daily at 02:30, kept 14 days, `/root/backups/tuition-lms/` on the server. Take a fresh one before a risky migration.',
        ],
      },
      { h2: 'Audit actions' },
      {
        table: {
          head: ['Action', 'Written by'],
          rows: [
            ['`account.create`, `account.update`', 'New account; name, notes or price book change'],
            ['`override.set`, `override.clear`', 'Overrides'],
            ['`account.trial`', 'Extend or start a trial'],
            ['`account.recount`', 'Recount today'],
            ['`account.suspend`, `account.unsuspend`', 'Suspension'],
            ['`invoice.generate`, `invoice.payment`, `invoice.void`', 'Invoices'],
            ['`price_book.create`, `price_book.update`', 'Price books (no account)'],
            ['`setting.update`', 'Settings (no account)'],
          ],
        },
      },
      {
        p: 'Longer runbooks live in the repository: `docs/runbooks/billing.md`, `docs/runbooks/plans.md` and `docs/runbooks/deploy.md`. The design is in `docs/SAAS_PLAN.md`.',
      },
    ],
  },
];
