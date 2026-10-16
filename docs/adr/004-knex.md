# 004 Knex for SQL and migrations

**Status:** Accepted, 2026-10-17

**Decision:** Knex for queries, transactions, migrations and seeds. Raw SQL for RLS policies and complex reports.

**Why:** Close to SQL (needed for RLS, locking, `ON CONFLICT`), mature, team preference.

**Consequences:** No ORM model layer. Types are written by hand in each module.
