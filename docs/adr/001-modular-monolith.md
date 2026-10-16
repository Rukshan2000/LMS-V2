# 001 Modular monolith

**Status:** Accepted, 2026-10-17

**Decision:** One API app (Fastify) with modules per feature, one Next.js web app, one worker added later. No microservices.

**Why:** Solo/small team. One deploy, shared DB transactions for money and attendance, easier debugging.

**Revisit when:** a module needs independent scaling or a separate team owns it.
