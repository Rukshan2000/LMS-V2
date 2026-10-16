# 002 Shared database with Row-Level Security

**Status:** Accepted, 2026-10-17

**Decision:** One PostgreSQL database and schema. Every tenant-owned table has `tenant_id` with RLS enabled and forced. The app connects as a non-owner role. The tenant is set per transaction with `set_config('app.tenant_id', ..., true)`.

**Why:** Cheap for many small institutes, one migration path. RLS is a second safety net if a query forgets a `WHERE tenant_id`.

**Consequences:** All tenant queries must run inside `withTenant()`. Migrations run as a separate owner role.

**Revisit when:** one tenant is large enough to need its own database.
