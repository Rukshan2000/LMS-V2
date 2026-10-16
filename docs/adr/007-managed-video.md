# 007 Managed video with overlay watermark

**Status:** Accepted, 2026-10-17

**Decision:** Host recorded lessons on Bunny Stream (or a similar provider). Playback uses short-lived signed tokens issued only to students with a verified payment for that month. The player shows a moving overlay with the student number and phone. Limit to 2 concurrent playback sessions.

**Why:** No transcoding to build. Asia delivery costs about $0.03/GB. Full DRM costs $99/month + per license, which is too expensive for MVP. The overlay deters screen recording and identifies leakers.

**Consequences:** Overlay is deterrence, not DRM. Say so clearly to teachers. Video GB is metered per tenant.

**Revisit when:** a large paying institute requires DRM. Enable provider DRM for that plan only.
