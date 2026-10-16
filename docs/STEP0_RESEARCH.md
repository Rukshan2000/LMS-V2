# Step 0: Market Research and Decisions

**Date:** 2026-10-17  
**Method:** Desk research (vendor websites, payment/messaging/video provider docs, IPS/HIES data, news). No customer interviews yet.  
**Status:** Research done. Interviews (section 7) still required before writing feature code.

> Vendor prices and claims below come from their own websites and are **unverified**. Re-check before quoting them.

---

## 1. Key finding: the market is crowded

At least 10 Sri Lankan products already sell tuition class software. Most already have the "obvious" features: QR attendance, free/half cards, SMS to parents, recorded videos, exams and ranks.

**Implication:** a feature list will not make us "the best". Every competitor has the same list. We must win on a sharp **wedge** (section 5) plus better UX, reliability and self-serve onboarding.

---

## 2. Market size

| Fact | Source |
|---|---|
| Households spending on tuition rose from 41% → 65% (urban) and 19% → 62% (rural), 1995–2016 | [IPS](https://www.ips.lk/talkingeconomics/2022/05/24/private-tutoring-amidst-sri-lankas-economic-crisis-issues-faced-by-students/) |
| ~48% of household education spending goes to private tuition (HIES 2019) | [Wikipedia / DCS](https://en.wikipedia.org/wiki/Private_tuition_in_Sri_Lanka) |
| Higher-income students spend LKR 18,000–20,000/month on tuition | [IPS](https://www.ips.lk/talkingeconomics/2022/05/24/private-tutoring-amidst-sri-lankas-economic-crisis-issues-faced-by-students/) |
| Industry revenue estimates range from LKR 16 bn to 210 bn/year (no reliable method) | [Wikipedia](https://en.wikipedia.org/wiki/Private_tuition_in_Sri_Lanka), [Sunday Times](https://www.sundaytimes.lk/231112/news/drawn-to-tutors-due-to-lack-of-teachers-but-its-a-big-struggle-to-afford-fees-538247.html) |

The money is real and spending is widespread. The software buyer, though, is the **teacher/institute**, and they are price-sensitive.

---

## 3. Competitors

| Product | Focus | Price (self-reported) | Notable |
|---|---|---|---|
| [CFMS / IT Signature](https://cfms.lk/) | Physical classes, smart card + SMS | LKR 99,000 bundle (software, app, 500 cards, hardware) | Hardware-led, RFID/fingerprint, one-time sale |
| [ClassFlow](https://classflow.lk/features/payment-management) | Institutes, multi-teacher | **Free**; LKR 500 per student pack/year | Free/half card, tute fee, AC fee, branches, teacher join requests. **No online payments** |
| [eduX](https://edux.lk/) | Physical + online | LKR 5,500/mo (100 students), 15,000/mo (500) | QR, Zoom auto-attendance, recordings, tutes, island/district ranks, bank slip upload, SMS. No WhatsApp mentioned |
| [Edumix](https://edumix.lk/) | Larger institutes, online | LKR 150/card/month, LKR 10,000 min | DRM video, POS, claims 100+ institutes |
| [Klass.lk](https://www.klass.lk/) | Online LMS | n/a | Zoom integration, claims 350+ educators |
| [tuitionfee.lk](https://tuitionfee.lk/) | Payments + attendance | LKR 1,999/mo (individual tutor) | "Most affordable" positioning |
| [SurakshaLMS](https://suraksha.lk/) | LMS | n/a | Mentions WhatsApp bot |
| [Smart Class / ECO IT](https://www.ecoit.lk/), [possystem.lk](https://possystem.lk/tuition-class-management-system), [classfeesmanagementsystem.com](https://classfeesmanagementsystem.com/) | Physical classes | n/a | Barcode + SMS, older style |
| [EduFlow](https://eduflow.lk/en/blog/school-management-software-cost-sri-lanka) | Schools/tuition | Publishes price guide | Trilingual |

### Market price bands (vendor-published guide, [EduFlow](https://eduflow.lk/en/blog/school-management-software-cost-sri-lanka))
| Segment | LKR / month |
|---|---|
| Solo tutor (1–25 students) | 0 – 2,500 |
| Tuition class (25–300) | 5,000 – 10,000 |
| Academy (300–2,000) | 12,000 – 25,000 |
| Large institute (2,000+) | 25,000 – 80,000 |

Buyer concerns noted in the same guide: hidden SMS/gateway add-ons, setup fees, data export on cancel, staff adoption, trilingual UI.

### Gaps seen across competitors
1. **WhatsApp-first messaging.** Almost all use SMS. Only SurakshaLMS mentions a WhatsApp bot.
2. **Offline reception desk.** None advertise it.
3. **Teacher revenue-share statements.** ClassFlow has multi-teacher; none clearly advertise automatic payout statements.
4. **Self-serve signup.** Most require a demo, a WhatsApp call or a hardware purchase.
5. **Transparent, flat pricing with passthrough messaging costs.** Mixed today: per-card, per-student pack, bundles.
6. **No independent reviews exist.** Trust is built through word of mouth and teacher Facebook groups.

---

## 4. Provider facts (for accounts and costs)

### PayHere ([official fees](https://www.payhere.lk/fees/), [limits](https://support.payhere.lk/limits-and-fees), [application](https://support.payhere.lk/application-process))
| Plan | Monthly | Fee | Limits |
|---|---|---|---|
| Lite | 0 | 3.30% | LKR 50k/payment, 200k/month |
| Plus | LKR 3,990 | 2.99% | 250k/payment, 3M/month |
| Premium | LKR 9,990 | 2.69% | 1M/payment, unlimited |

No setup fee. HelaPay costs 1.99%. Amex/Diners cost +0.5%. **Requirements:** registered business + local bank account. Approval is done by a partner bank.  
**Decision:** Each **institute is its own PayHere merchant** (money goes straight to them). We do not hold student money. This avoids becoming a payment intermediary.

### WhatsApp Business Platform ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing))
- Per-message pricing since 2025-07-01. Utility (receipts, attendance) and authentication messages are charged. Service replies within the 24h window are free.
- Meta says Sri Lanka utility/auth rates are scheduled to **decrease**. Check the official rate card for the exact LKR/USD rate before setting prices.
- Needs a Meta Business account, a verified business, a dedicated phone number and pre-approved templates.  
**Decision:** One platform WhatsApp number at launch (our brand, institute name in the template). Per-institute numbers are Phase 2.

### SMS
- About LKR 0.30–0.50 per message (vendor guide). This is the fallback channel. Use a local SMS gateway with a sender mask.

### Video: Bunny Stream ([pricing docs](https://docs.bunny.net/stream/pricing))
- Storage $0.01/GB. Delivery to Asia **$0.03/GB**. Standard encoding free. $1/month minimum.
- Full DRM: $99/month + per-license fee. **Not needed for MVP.**
- No per-viewer dynamic watermark built in. **We render the watermark as a player overlay.**
- Cost example: 200 students × 8 hrs/month × ~0.7 GB/hr (720p) ≈ 1,120 GB ≈ **$34/month**. Pass this cost through to institutes via plan quotas.

### Hosting
- Use the Singapore or Mumbai region for low latency to Sri Lanka.

### Law: Personal Data Protection Act No. 9 of 2022
- Amended by **Act No. 22 of 2025**. Provisions come into force by gazette order. The DPA's [Aug 2026 circular](https://dpa.gov.lk/media/DPA_Circular_012026_E.pdf) confirms a phased start. No commencement date for the main obligations was found. ([Wikipedia](https://en.wikipedia.org/wiki/Personal_Data_Protection_Act_(Sri_Lanka)))
- **Decision:** Build as if it applies now: consent, a privacy notice, data export/delete, minimal collection, extra care for minors' data. Confirm with a lawyer before launch.

---

## 5. Positioning (our wedge)

> **"Student pays, access unlocks, parent gets a WhatsApp. No manual work."**

(Updated after [user research](STEP0_USER_RESEARCH.md): the most-cited pain is slip → manual access for online classes. Offline desk is now a supporting feature, because there is no evidence of serious 2025–26 power cuts.)

Target the **first customer segment**: **individual teachers and small classes (25–300 students) running hybrid classes**. Reasons:
- They are the biggest group and decide fast (no committee).
- Competitors either sell hardware bundles (too heavy for them) or need a demo call.
- Hybrid teachers feel all the pains at once: desk attendance, slips, recordings, parent messages.

| Wedge | Why it wins |
|---|---|
| WhatsApp receipts, attendance and results to parents | Parents read WhatsApp; others send SMS |
| Offline desk scanning | Power cuts and bad signal are common |
| Bank slip → verify → auto-unlock lessons | The real online-class flow, made fast |
| Teacher payout statement | Institutes do this by hand in Excel today |
| Self-serve signup in 5 minutes, Sinhala first | No demo call, no hardware |
| Free for small classes | Beats paid entry tiers; matches ClassFlow's free tier |

**Not competing on:** hardware/RFID, island-wide ranks, large institute ERP.

---

## 6. Pricing hypothesis (validate in interviews)

| Plan | LKR / month | Limits |
|---|---|---|
| Free | 0 | 50 students, 1 staff, QR attendance, fees, receipts. WhatsApp/SMS pay-as-you-go |
| Teacher | 2,900 | 300 students, 3 staff, slips, recordings (50 GB delivery), payouts |
| Institute | 9,900 | 1,500 students, unlimited staff, 300 GB delivery, multi-teacher payouts |
| Large | Quote | Branches, custom |

- **Flat pricing, not per student.** Competitor guides say per-student pricing "punishes growth".
- WhatsApp/SMS sold as prepaid credit, at cost + margin, shown clearly (buyers hate hidden add-ons).
- Free CSV import, free data export, no setup fee.

---

## 7. What desk research cannot answer: do these interviews

No customers yet is normal. Get **5 conversations in 2 weeks**:

1. **Who:** 2 individual teachers, 2 small institutes, 1 online A/L teacher.
2. **Where to find them:**
   - Your own network: ask everyone "do you know a tuition teacher?"
   - Teacher Facebook groups (e.g. groups for A/L/O/L teachers in Sinhala).
   - Walk into 3 local tuition institutes on a weekday afternoon and ask for the manager.
   - Online teachers' public pages/YouTube. Message them politely.
3. **Offer:** "I'm building a free tool for tuition classes. Can I ask 20 minutes of questions? You get it free for 1 year."

### Interview script (20 minutes, do not pitch)
1. Walk me through a normal class day from when students arrive.
2. How do you mark attendance? What goes wrong?
3. How do students pay? Cash, slip, online? How do you check slips?
4. How do you tell parents about attendance, fees, results? WhatsApp groups? SMS?
5. Do you record lessons? How do you share them? Has anyone leaked them?
6. (Institutes) How do you pay teachers? Show me the sheet.
7. What software have you tried? Why did you stop?
8. If one thing became automatic tomorrow, what would it be?
9. What would you pay per month for that?
10. Can I come and watch one class day?

**Record:** exact words, tools used, current spend, top pain. After 5 interviews, update section 5 and 6 and the MVP table in [implementationplan.md](../implementationplan.md).

### Kill / pivot signals
- 4 of 5 say "ClassFlow (free) is good enough" → narrow to the online/hybrid wedge only.
- Nobody uses WhatsApp for parents → drop WhatsApp-first, lead with offline desk + slips.
- Nobody would pay > LKR 1,000 → free product + revenue from WhatsApp/SMS credits and video.

---

## 8. Accounts checklist

| Account | Needs | Status |
|---|---|---|
| Business registration (sole proprietor is fine) | NIC, business name | ☐ (PayHere and Meta verification need it) |
| Business bank account | Registration | ☐ |
| Domain + Cloudflare | Name ideas | ☐ |
| GitHub org + repo | — | ☐ |
| PayHere **sandbox** | Email only | ☐ (start dev now) |
| PayHere live merchant | Business reg + bank | ☐ (for our own SaaS billing later) |
| Meta Business + WhatsApp Cloud API | Verified business, new phone number | ☐ |
| Local SMS gateway | Business reg, sender mask approval | ☐ |
| Bunny.net (Stream) | Card | ☐ |
| Hosting (Singapore/Mumbai) | Card | ☐ |
| Sentry (free tier) | — | ☐ |

---

## 9. Decisions recorded

See [docs/adr/](adr/):
- [001 Modular monolith](adr/001-modular-monolith.md)
- [002 Shared DB with RLS](adr/002-shared-db-rls.md)
- [003 Session cookies](adr/003-session-cookies.md)
- [004 Knex for SQL and migrations](adr/004-knex.md)
- [005 Payments: institute is the merchant](adr/005-payments-institute-merchant.md)
- [006 WhatsApp first, SMS fallback](adr/006-whatsapp-first.md)
- [007 Managed video with overlay watermark](adr/007-managed-video.md)
- [008 First segment and flat pricing](adr/008-segment-and-pricing.md)
