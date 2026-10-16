# 005 Payments: institute is the merchant

**Status:** Accepted, 2026-10-17

**Decision:** Each institute connects its **own** PayHere merchant account (merchant ID + secret stored encrypted). Student money goes directly to the institute. Bank slips are uploaded by students and verified by institute staff. We never hold student money.

**Why:** Avoids acting as a payment intermediary (licensing, settlement risk, trust). PayHere requires a registered business + local bank, which institutes have. Small teachers without a merchant account use slips only.

**Our own SaaS subscription** is billed through our own PayHere account (later), manually at first.

**Revisit when:** many teachers lack a business registration and ask us to collect for them.
