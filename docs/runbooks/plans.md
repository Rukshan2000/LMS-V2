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

## Trials

Account page → **Extend trial** → days. A running trial is extended from its end date and its trial caps move with it; an ended trial restarts from today (without caps). Trial days are never billed.

The default trial length and caps for new sign-ups are on **Settings**.

## Suspend (read-only)

Only for accounts that don't pay after reminders. Account page → reason → **Suspend** → click again. The customer sees the account as suspended and can't add students, teachers, parents or institutes. The full read-only block (every change refused) comes with Phase 4. **Unsuspend** lifts it at once.

An unpaid account is already `restricted` automatically (no new heads, fee collection still works); suspension is the manual step after that.
