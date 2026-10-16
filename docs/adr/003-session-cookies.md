# 003 Session cookies for auth

**Status:** Accepted, 2026-10-17

**Decision:** Server-side sessions in an `auth_sessions` table. HttpOnly, Secure, SameSite=Lax cookie. Argon2id password hashing. Phone OTP added for students/parents later.

**Why:** Revocable (logout everywhere, ban staff), no token storage in the browser, simple.

**Revisit when:** a native mobile app needs token auth.
