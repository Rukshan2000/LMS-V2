# Runbook: activate or extend a paid plan

v1 has no payment gateway. A teacher pays by bank transfer, sends the slip, and you switch the plan on by hand.

| Plan | Price (ADR 008) | Active students |
|------|-----------------|-----------------|
| free | 0 | 50 |
| teacher | LKR 2,900 / month | 400 |
| institute | LKR 9,900 / month | no limit |

Limits live in `apps/api/src/lib/plans.ts`. When a paid plan expires the institute is back on Free limits: nothing is deleted, but new or re-activated students are refused while they are over 50.

## Activate / extend

1. Check the transfer arrived in the bank account.
2. Find the institute (the slug is in their link, e.g. `nimal-maths`):

```bash
ssh root@164.68.97.187
sudo -u postgres psql -d tuition_lms -c "SELECT id, slug, name, plan, plan_expires_at FROM tenants WHERE slug = 'nimal-maths'"
```

3. Set the plan. Extending adds to the current expiry if it is still in the future, so paying early loses nothing:

```bash
sudo -u postgres psql -d tuition_lms -c "
  UPDATE tenants
     SET plan = 'teacher',
         plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '1 month',
         status = 'active', updated_at = now()
   WHERE slug = 'nimal-maths'
  RETURNING slug, plan, plan_expires_at"
```

Use `interval '12 months'` for a yearly payment and `plan = 'institute'` for the bigger plan.

4. Tell the teacher on WhatsApp; Settings → Plan shows the new plan and expiry immediately.

## Back to Free

```bash
sudo -u postgres psql -d tuition_lms -c "UPDATE tenants SET plan = 'free', plan_expires_at = NULL WHERE slug = 'nimal-maths'"
```
