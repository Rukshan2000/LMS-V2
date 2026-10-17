# Runbook: prices, discounts, trials and suspension

Everything here is done in the **platform console** at `/admin` (SAAS_PLAN §10), and every change is audited (**Audit log**). The old flat plans (`tenants.plan`, ADR 008) no longer apply; billing is per head (ADR 009). Getting console access is in [billing.md](billing.md#one-time-setup-the-first-platform-admin). Monthly invoices and payments are in [billing.md](billing.md) too.

## A new customer you signed up yourself

**Accounts → New account**: account name, owner name and mobile, price book, free trial days → **Create account** → **Send sign-up message on WhatsApp**.

When the owner signs up **with that mobile** and creates an institute, it joins this account (claiming by phone, SAAS_PLAN §10.3). Until then the list shows "Not signed up yet". A mobile that already has an account is refused. Accounts created here get no trial caps; set caps as overrides if you want them.

Customers who sign up on their own get an account automatically: the default price book, `trial_days` free and the trial caps from Settings.

## Change prices for everyone: price books

**Price books**: books × keys grid. Prices are LKR per head per month (`price.*`), free heads per month (`included.*`), `minimum.monthly`, caps (`cap.*`, blank = no limit) and features (`feature.*`).

- **Save** shows how many accounts use the book; click again to save.
- Changes apply from the **next** invoice. Past invoices never change.
- **New price book** starts as a copy of the default one (e.g. `ngo`, `pilot`). Move an account to it on the account page (**Price book**).
- Unknown keys and bad values (negative, more than 2 decimals) are refused.

## Change one customer: overrides

Account page → **Set override**: key, value, optional expiry date, and a note saying why (required). The override wins over the price book until it expires. Rows with an override are highlighted in **Prices, caps and features**; **Remove** goes back to the book.

Examples:

| Need | Key | Value |
|---|---|---|
| Students at LKR 80 until March | `price.student` | `80`, expires 31 March |
| First 20 students free | `included.student` | `20` |
| Allow a 4th institute | `cap.institutes` | `4` |
| No student cap | `cap.students` | blank |
| Switch the parent app off | `feature.portal` | Off |

### What switching a feature off does

The customer sees a lock on the menu item and a "not included in your plan" card on the page; the server refuses the action with `feature_locked`. Nothing is deleted, and switching it back on restores everything.

| Feature | Off means |
|---|---|
| `feature.reports` | Reports page and all CSV downloads refused |
| `feature.student_import` | CSV import refused; adding students one by one still works |
| `feature.bank_slips` | Parents can't upload slips and the desk's Bank slips queue is locked. Pending slips stay pending and reappear when it is on again; the desk can still record the payment at the counter |
| `feature.live_links` | A link can't be set (clearing one is allowed). Links already set are kept but hidden from parents and students |
| `feature.portal` | New parent/student invites can't be sent or accepted. Families already in keep their access |

### Caps

`cap.students`, `cap.teachers`, `cap.parents`, `cap.institutes`. A teacher is checked when invited and again when the invite is accepted (pending invites don't count). A parent is checked only when accepting; inviting is free. A parent already linked to one child who accepts an invite for a sibling is not a new head. Admins and receptionists have no cap key.

## Trials

Account page → **Extend trial** → days. A running trial is extended from its end date and its trial caps move with it; an ended trial restarts from today (without caps). Trial days are never billed.

The default trial length and caps for new sign-ups are on **Settings**.

## Suspend (read-only)

Only for accounts that don't pay after reminders. Account page → reason → **Suspend** → click again. The account becomes **read-only**: staff can open every page, the Billing page and download reports, but every change is refused (`account_suspended`), including attendance scans and fee payments. Parents and students can still view the portal but can't upload slips or accept invites. Everyone sees a red banner. **Unsuspend** lifts it at once.

An unpaid account is already `restricted` automatically (no new heads, fee collection still works); suspension is the manual step after that.
