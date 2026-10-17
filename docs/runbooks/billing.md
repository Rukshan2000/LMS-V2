# Runbook: monthly subscription billing (until the console exists)

Per-head billing (ADR 009, SAAS_PLAN §6). Head counts are recorded automatically by database triggers into `tenant_usage_daily`. Once a month you generate invoices, then record bank transfers as they arrive. Until the super admin console ships (Phase 3), both are done with the temporary `billing` CLI. It calls the same service functions the console will use, so every action writes a `platform_audit` row.

The CLI runs as the **app role** (`DATABASE_URL`, RLS applies) and acts as a platform admin, given by `BILLING_ADMIN_PHONE`.

## One-time setup

Make yourself platform admin (only the platform owner, SAAS_PLAN §14):

```bash
ssh root@164.68.97.187
sudo -u postgres psql -d tuition_lms -c "UPDATE users SET is_platform_admin = true WHERE phone = '9477XXXXXXX' RETURNING id, full_name"
```

The command used on the server below is:

```bash
cd /var/www/tuition-lms
billing() { docker compose run --rm --no-deps -e BILLING_ADMIN_PHONE=077XXXXXXX api node dist/billing.js "$@"; }
```

(`api` already gets `DATABASE_URL` from `app.env`.) Locally the same commands are `npm run billing -w apps/api -- <command>`, with `DATABASE_URL` and `BILLING_ADMIN_PHONE` from `.env`.

## 1st of each month: generate invoices

```bash
billing generate 2026-10        # the month that just ended (Asia/Colombo)
```

- One invoice per account: peak heads per day summed over its institutes, minus free allowance, × unit price; topped up to `minimum.monthly`. Days on or before `trial_ends_at` are free.
- Accounts in trial all month, or owing 0, get no invoice.
- Numbers are `S-<period>-NNNN`, due `invoice_due_days` (7) after today.
- **Safe to run twice:** an account that already has an invoice for the month is skipped. Only finished months are accepted.
- Prices and overrides are read **now** and copied into the invoice. To give a discount for the month, set the override *before* generating.

Check the result:

```bash
sudo -u postgres psql -d tuition_lms -c "
  SELECT i.number, a.name, i.total, i.due_date, i.status, i.lines
    FROM subscription_invoices i JOIN accounts a ON a.id = i.account_id
   WHERE i.period = '2026-10' ORDER BY i.number"
```

Send each owner their number and amount on WhatsApp, with the bank details (the Billing page shows this from Phase 4).

## When a transfer arrives: record the payment

```bash
billing pay S-2026-10-0001 21500 "BOC 2026-11-03 #4471"
```

- Part payments are fine; the invoice becomes `paid` when payments reach the total. More than the amount due is refused (it prints what is due).
- **Safe to run twice:** the same invoice + bank reference records once. Use a different reference for a genuinely second transfer.
- Recording the payment lifts `overdue` / `restricted` immediately.

## Mistakes: void an invoice

```bash
billing void S-2026-10-0001 "Counted a test institute"
```

Only an open invoice without payments can be voided. A voided month **cannot be regenerated** (one invoice per account per month); until credit notes exist (Phase 3), settle the difference by hand and note it in `accounts.notes`.

## What the customer sees

Nothing changes on screen in Phase 2. Account state still applies (SAAS_PLAN §5.2): the day after the due date the account is `overdue` (can still add people); after 7 more days (`grace_days`) it is `restricted` (no new students / teachers / parents; everything else keeps working).

## Checks

- Metering is working: after any student is added, today's row appears.

  ```bash
  sudo -u postgres psql -d tuition_lms -c "SELECT day, head, sum(count_last) FROM tenant_usage_daily WHERE day = (now() AT TIME ZONE 'Asia/Colombo')::date GROUP BY 1, 2"
  ```

- Audit trail: `SELECT created_at, action, after FROM platform_audit ORDER BY id DESC LIMIT 20`.
