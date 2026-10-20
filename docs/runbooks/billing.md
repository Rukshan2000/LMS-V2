# Runbook: monthly subscription billing

Per-head billing (ADR 009, SAAS_PLAN §6). Database triggers record head counts into `tenant_usage_daily` automatically. Once a month you generate invoices; as bank transfers arrive you record them. Both are done in the **platform console** at `/admin` (SAAS_PLAN §10). Every action there writes one `platform_audit` row (who, which account, before, after, IP), visible in **Audit log**.

Prices, overrides, trials and suspension: see [plans.md](plans.md).

## One-time setup: the platform owner

The only SQL in this runbook. There is exactly one platform owner (a unique index enforces it); adding admins waits for 2FA.

Use a dedicated email that owns no institute. Sign it up on the normal signup page first (no institute needed), then:

```bash
ssh root@164.68.97.187
sudo -u postgres psql -d tuition_lms -c "UPDATE users SET is_platform_admin = (lower(email) = 'console@example.com') RETURNING id, full_name, is_platform_admin"
```

This also unflags any earlier admin. Log in at **/en/admin/login**: a separate login with its own cookie that works only on the console. That email can no longer use the institute app login, and institute users get "not found" from the console. Console logins expire after 12 hours.

Before the first real invoice, fill in **Settings → Bank details** and **Support WhatsApp**.

## 1st of each month: generate invoices

1. **Invoices**, pick the month that just ended (it is the default).
2. **Check totals**: lists what each account would be billed. Nothing is created yet.
3. **Generate invoices for YYYY-MM**, then click again to confirm.

- One invoice per account: the peak heads per day, summed over its institutes, minus the free allowance, × unit price, topped up to `minimum.monthly`. Days on or before `trial_ends_at` are free.
- Accounts in trial all month, or owing 0, get no invoice.
- Numbers are `S-<period>-NNNN`, due `invoice_due_days` (Settings) after today.
- **Safe to run twice:** accounts that already have an invoice for the month are skipped. Only finished months are accepted.
- Prices and overrides are read **at generation** and copied into the invoice. To give a discount for the month, set the override (plans.md) *before* generating.
- **Download CSV** exports the month's list.

Send each owner their number and amount on WhatsApp: **Accounts** → **Remind** on the row (the message has the invoice number and amount due).

## When a transfer arrives: record the payment

**Accounts** → the account → **Invoices** → enter the amount (the amount due is filled in) and the bank reference → **Record payment**.

- Part payments are fine; the invoice is `paid` when payments reach the total. More than the amount due is refused.
- A double click records once (each attempt carries one `clientRef`).
- Recording the payment lifts `overdue` / `restricted` immediately.

## Mistakes: void and regenerate

On the account's invoice: type a reason → **Void** → click again to confirm. Only an open invoice **without payments** can be voided.

Then fix the cause (override, price book, trial) and generate the month again on **Invoices**: the voided invoice stays as a record and the account gets a new one with the next number (migration 015). Other accounts are not touched, because they already have their invoice.

An invoice that already has payments can't be voided. Settle the difference with the customer and write it in the account's **Notes**, until credit notes exist.

## What the customer sees

Account state (SAAS_PLAN §5.2): the day after the due date the account is `overdue` (can still add people); after `grace_days` more days (Settings) it is `restricted` (no new students / teachers / parents; everything else keeps working). Owners and admins see a banner (trial days left, amount and due date when overdue, "pay to add more" when restricted) and the **Billing** page: this month so far (the same calculation as the invoice), their invoices, the bank details and support WhatsApp from **Settings**, and a **Send slip on WhatsApp** button per unpaid invoice that carries the invoice number and amount. Teachers and receptionists see the same banner without the link to Billing; parents and students see a banner only when the account is suspended.

Fill in **Settings → Bank details** and **Support WhatsApp** before the first invoice: without them the Billing page says bank details are coming and shows no WhatsApp button.

## Checks

- **Metering works:** an account's page shows **Heads per day this month**; after a student is added, today's count rises.
- **Audit trail:** **Audit log**, or the **History** section on an account.
