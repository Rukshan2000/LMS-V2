# 010 Email identity with one-time codes

**Status:** Accepted, 2026-10-17. Supersedes "Phone OTP for students/parents later" in [ADR 003](003-session-cookies.md).

**Decision:** Users log in with a verified email and a password. Every email is proven by a 6-digit code sent to it (sign-up, password reset, email change). Staff, portal and console-account invitations are emailed. Mail goes out over SMTP (Gmail for the pilot). Phone stays as contact data for WhatsApp ([ADR 006](006-whatsapp-first.md)), not as a login key.

**Why:** Phone numbers were never verified, so anyone could sign up with someone else's number and claim their invite or account. Email codes cost nothing per message, unlike SMS.

**Consequences:** Users from before the change log in by phone once and must add an email. Gmail sends to about 500 recipients a day, so a transactional provider is needed before a wide launch. Parents without email still get the copy-link fallback.

**Revisit when:** mail volume nears the Gmail limit, or parents without email are common enough to need SMS/WhatsApp codes.
