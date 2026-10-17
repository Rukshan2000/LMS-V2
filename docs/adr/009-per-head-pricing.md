# 009 Per-head monthly pricing, set by the platform admin

**Status:** Accepted, 2026-10-17. Supersedes the flat pricing in [008](008-segment-and-pricing.md) (the segment decision in 008 still stands).

**Decision:** Customers are billed monthly per head, after the month ends: the peak number of active students, teachers and parents in the month, summed across the customer's institutes, × a unit price. Every price, free allowance, minimum charge, cap and feature switch is data the platform admin sets: in price books (which the admin can create) or per customer as an override (optionally expiring). Nothing is hard-coded.

Seeded starting values (editable): student LKR 100, teacher 2,000, parent 50, admin 0, receptionist 0; no allowance or minimum; up to 3 institutes per account. New customers get a 30-day trial capped at 100 students, 5 teachers and 1 institute. Existing customers get at least 30 days free before their first bill. An invoice unpaid 7 days after its due date blocks adding new heads only; fee collection keeps working, and suspension is a manual admin action. Only the platform owner is super admin (set by SQL) until 2FA exists.

**Why:** The owner wants revenue to grow with each customer's size, and wants prices adjustable per customer without a deploy. Peak counting can't be gamed by deactivating before billing and is easy to explain. Design and research: [SAAS_PLAN.md](../SAAS_PLAN.md).

**Consequences:** Needs accounts above institutes, automatic head-count metering, monthly invoices and a super admin console ([SAAS_TASKS.md](../SAAS_TASKS.md)). Contradicts 008's finding that buyers dislike per-student pricing; mitigated by admin-set prices, per-customer overrides and a live estimate on the customer's Billing page.

**Revisit when:** prices have been checked with at least 2 pilot teachers, and again after 3 months of invoices.
