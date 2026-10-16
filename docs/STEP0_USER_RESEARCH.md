# Step 0.1: User Research (public sources instead of interviews)

**Date:** 2026-10-17  
**Why this method:** No access to real teachers yet. This replaces the 5 interviews with evidence from public sources: competitor sales pages (what pains they sell against), operator guides, news, academic studies and app listings.  
**Limit:** These are **second-hand** sources, mostly vendors. They show what problems exist, not how much people will pay. Real teachers must confirm the top findings during the pilot (see the last section).

Confidence: **High** = several independent sources agree · **Medium** = 1–2 sources, plausible · **Low** = assumption, weak evidence.

---

## 1. Interview questions answered from evidence

### Q1. What does a normal class day look like?
- Formats: large lecture halls for A/L science, small groups at institutes or tutors' homes, and one-to-one tutoring. ([Wikipedia](https://en.wikipedia.org/wiki/Private_tuition_in_Sri_Lanka)) **High**
- Many classes are taught by government teachers as a second income (salaries around LKR 30,000–50,000). ([ESSF study, Anuradhapura](https://www.europe-solidaire.org/spip.php?article70134=), [HRW 2025](https://www.hrw.org/report/2025/10/14/tax-giveaways-struggling-schools/how-low-taxes-drove-sri-lankas-economic-crisis)) **High**  
  → They teach in evenings and weekends, have little time for admin, and use their phone, not a desktop.

### Q2. How is attendance marked? What goes wrong?
- Paper register or Excel at the start; "breaks down past about 50 students". ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) **Medium**
- Pains competitors sell against: paper registers, "revenue leakage at class entrances" (students attend without paying), parents wanting proof of attendance, expensive barcode hardware. ([tuitionfee.lk](https://tuitionfee.lk/)) **High** (repeated by CFMS, eduX, ClassFlow)
- Existing tools use QR on phone camera, barcode guns, RFID/NFC cards and fingerprint. ([CFMS](https://cfms.lk/), [ClassFlow](https://classflow.lk/features)) **High**

### Q3. How do students pay? How are slips checked?
- **Physical classes:** cash at the desk, monthly, collected by the 5th with a reminder on the 1st. ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) **Medium**
- **Online classes:** form → bank deposit → **photo of slip sent on WhatsApp** → teacher checks bank app → manually adds student to WhatsApp group / sends link. ([Elevate Academy](https://elevateacademy.lk/), [Pay2Join article](https://nothingapps.com/the-ultimate-guide-for-sri-lankan-tuition-teachers-automate-your-online-classes-with-pay2join/)) **High**
- Exact pains quoted: "blurry bank slip photos", "is this slip fake?", students wait **days** for approval, "scrolling through 300 WhatsApp messages", someone must be awake to approve late-night payers. ([Pay2Join article](https://nothingapps.com/the-ultimate-guide-for-sri-lankan-tuition-teachers-automate-your-online-classes-with-pay2join/)) **Medium** (one vendor, but matches others' slip-upload features)

### Q4. How are parents told about attendance, fees, results?
- Competitors send **SMS** on check-in, fee payment and marks. ([eduX](https://edux.lk/), [tuitionfee.lk](https://tuitionfee.lk/), [CFMS](https://cfms.lk/)) **High**
- Teachers recruit and talk to parents through **WhatsApp** and personal networks. ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) Every vendor uses WhatsApp for its own sales and support. **High**
- Parents want reassurance that the child actually attended. ([ClassManager-Parent](https://apps.apple.com/vn/app/classmanager-parent/id1508994350), [tuitionfee.lk](https://tuitionfee.lk/)) **High**

### Q5. Recordings: how are they shared? Are they leaked?
- Recordings are sold as monthly access or packages, requested over WhatsApp. ([Elevate Academy](https://elevateacademy.lk/)) **Medium**
- **Link leakage** is a named pain: one student forwards the group or class link to friends who haven't paid. ([Pay2Join article](https://nothingapps.com/the-ultimate-guide-for-sri-lankan-tuition-teachers-automate-your-online-classes-with-pay2join/)) **Medium**
- Competitors advertise "piracy-proof" or DRM video ([Edumix](https://edumix.lk/), [ClassLMS](https://classlms.com/)), so teachers ask for it. **Medium**
- No Sri Lankan news report of recordings leaked on Telegram was found. Leak size is unknown. **Low**

### Q6. How are teachers paid by institutes?
- **Teacher gets 30–50% of fees collected** (higher if they bring their own students). The institute keeps the rest. Paid as a percentage, not a salary, in the first year. ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) **Medium**
- Late teacher pay makes teachers leave. (same source) **Medium**
- Famous A/L teachers often rent halls and keep most of the fees. This is common knowledge, but no source was found. **Low**  
  → The payout model must support **both**: teacher % share, and institute fixed hall rent or % share.

### Q7. What software has been tried? Why did people stop?
- More than 10 local products exist (see [STEP0_RESEARCH.md](STEP0_RESEARCH.md)). **No independent reviews or complaints were found online.** **Low**
- Buyer warnings from vendor guides: hidden SMS and gateway costs, setup fees, no data export, staff not adopting the tool. ([EduFlow cost guide](https://eduflow.lk/en/blog/school-management-software-cost-sri-lanka)) **Medium**

### Q8. What one thing should become automatic?
Ranked by how often vendors sell against it:
1. **Payment → access**: slip/online payment unlocks class, link and recordings with no manual step. **High**
2. **Attendance + parent notification.** **High**
3. **Who hasn't paid this month** list. ([ClassFlow](https://classflow.lk/features/payment-management)) **High**
4. Teacher payout calculation. **Low** (inferred, nobody sells it strongly)

### Q9. What would they pay?
| Product | Price |
|---|---|
| ClassFlow | Free; LKR 500 per student/year |
| tuitionfee.lk | 1,999 / 4,990 / 6,999 per month |
| eduX | 5,500 (100 students) / 15,000 (500) per month |
| Edumix | 150 per card/month, 10,000 min |
| Pay2Join (online group access only) | ~USD 18/month flat, no commission |

Fee context: an A/L class charges LKR 7,000–18,000 per student/month (top tutors 15,000–35,000+). ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) For a 100-student A/L class that is about LKR 1M/month revenue, so LKR 2,900 is under 0.3%. **Price is not the main barrier. Trust and ease are.** **Medium**

### Q10. Typical fee structure
- Base monthly class fee + optional **AC fee** (air-conditioned hall) + **tute/material fee** + free cards + discounts. ([ClassFlow](https://classflow.lk/features/payment-management)) **High**
- Half cards and free cards are standard. ([eduX](https://edux.lk/)) **High**
- Sibling discount about 10%. Monthly billing, not per class. No refund for missed classes unless the teacher cancels. Late fees. ([EduFlow guide](http://eduflow.lk/en/blog/how-to-start-tuition-class-sri-lanka)) **Medium**

---

## 2. Personas (built from evidence)

### P1. Online A/L teacher, "Nimal" (primary)
- Government teacher, evening and weekend online classes, 80–300 students across 2–3 batches.
- Runs everything on WhatsApp: slips, groups, links, recordings.
- **Pain:** hours per week checking slips, adding students to groups, link leakage, students waiting days.
- **Wants:** pay → auto access, protected recordings, a list of who hasn't paid.
- **Uses:** phone first.

### P2. Small institute owner, "Kumari"
- 2–6 teachers, 1 hall, 200–800 students, a receptionist at the desk.
- **Pain:** entry without payment, paper/Excel attendance, parents asking "did my child come?", monthly teacher payout by hand.
- **Wants:** QR desk scan, fee status at entry, parent message, payout sheet.
- **Uses:** desktop + barcode gun at the desk, phone for reports.

### P3. Home tutor, "Saman"
- Fewer than 50 students, grade 6 to O/L.
- Paper register works for now. Would not pay much.
- **Wants:** free, simple attendance + fee list + reminder.
- **Segment for the free plan.** They become paying customers when they grow past 50 students.

### P4. Parent
- Pays monthly. Wants proof of attendance and results.
- Reads **WhatsApp**, not email.

---

## 3. What this changes in the plan

| Finding | Change | Done |
|---|---|---|
| Online teachers' #1 pain is slip → manual access | Lead positioning with **"payment unlocks access automatically"** | ✓ research doc updated |
| Teacher share is 30–50%, not 75% | Payout rules support teacher-% and institute-% or fixed hall rent. Example changed | ✓ plan updated |
| AC fee and tute fee are separate lines | Add fee line types: `class`, `ac`, `tute`, `admission`, `late` | ✓ plan updated |
| Collect by 5th, remind on 1st, late fee | Billing defaults: issue on 1st, due on 5th, optional late fee | ✓ plan updated |
| Paper breaks down around 50 students | Free plan cap at 50 matches the pain threshold. Keep it | ✓ |
| Power cuts were severe in 2022, but no 2025–26 evidence | Offline desk drops from headline wedge to supporting feature | ✓ research doc updated |
| Link leakage named | Join links are per student and issued only after payment, never a shared group link | ✓ plan updated |
| WhatsApp is the channel teachers and parents use | ADR 006 → Accepted | ✓ |

---

## 4. Still to confirm with real users (during pilot)

These are the riskiest assumptions. Ask the first 3 pilot users:

1. Would you trust slip verification inside an app instead of on WhatsApp?
2. Is per-student watermark + 2-device limit enough for recordings?
3. Do you (institutes) calculate teacher payouts by %? Show the sheet.
4. Would you pay LKR 2,900/month after a free trial? Why or why not?
5. Do parents actually read WhatsApp messages from a business number?

### Where to find real users later
- Teachers advertising on [advice.lk/tuition](https://advice.lk/tuition/) and [iskolaya.lk](https://iskolaya.lk/advertising_rates) list public contact numbers. Message 20 and offer 1 year free.
- Online A/L teachers' public Facebook pages and YouTube channels.
- Local institutes: visit in person on a weekday afternoon.
