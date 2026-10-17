# Tuition LMS: UI and UX upgrade plan

**As of:** 2026-10-17, based on [UI_UX.md](UI_UX.md) (current state, commit `5557af9`)
**Code:** `apps/web/src` (Next.js 16, React 19, Tailwind CSS 4)
**Status:** implemented 2026-10-17 (phases 1–6). Not checked on a real phone: the browser used for the check could not go below about 1200px wide.
**Goal:** a calmer, more professional look: a blue and white pastel palette, smooth transitions and a small icon set, with nothing lost on Sinhala-first text, phone use, printing or accessibility.

---

## 1. What changes and what stays

| Changes | Stays the same |
|---|---|
| Indigo + zinc → **blue + white pastel** palette, defined once as tokens | Layouts, URLs, flows, screen content |
| Flat cards → soft, blue-tinted shadows and lighter borders | Sinhala first, all strings in 3 dictionaries |
| Words only → **icons + words** (menu, status badges, key buttons, empty states) | Status is never colour-only; the word always shows |
| Instant state changes → **short CSS transitions** (150–300 ms) | Native inputs and pickers |
| "Loading…" text → skeleton rows; shell stays visible | WhatsApp open-don't-send model |
| Hand-written button classes → `Button` variants | Print layouts (print stays plain black on white) |

Out of scope: dark mode (tokens make it a later, small job), custom date pickers, logo/brand work, animation libraries.

---

## 2. Palette (tokens)

All colours go into `app/globals.css` under `@theme`, so Tailwind generates utilities like `bg-primary`, `text-ink-muted`, `border-line`. No screen uses a raw Tailwind colour (`indigo-600`, `zinc-500`…) after the migration.

### 2.1 Base

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F9FF` | Page background (very light blue-white) |
| `surface` | `#FFFFFF` | Cards, sections, header, sidebar |
| `surface-soft` | `#EEF5FF` | Hover rows, table header, selected sidebar item, input background on focus |
| `line` | `#DCE7F5` | Card and section borders, dividers |
| `line-strong` | `#C3D5EC` | Input borders, secondary button borders |
| `ink` | `#0F1E36` | Main text (deep navy, softer than black) |
| `ink-muted` | `#475569` | Secondary text, labels |
| `ink-subtle` | `#64748B` | Hints, timestamps (still ≥ 4.5:1 on white) |

### 2.2 Primary (blue)

| Token | Hex | Use |
|---|---|---|
| `primary` | `#2563EB` | Primary buttons, links, active menu text (5.2:1 on white) |
| `primary-hover` | `#1D4ED8` | Hover / pressed |
| `primary-soft` | `#E0ECFF` | Active menu pill, selected chips, info panels |
| `primary-ring` | `#BFD6FF` | Focus ring |
| `accent-sky` | `#CFE6FF` | Decorative only: auth page background wash, empty-state icon circles |

### 2.3 Status (pastel background + strong text)

Pastel fills keep the calm look; text and solid buttons are darkened so they still pass WCAG AA.

| Meaning | Soft bg | Text | Solid (white text) |
|---|---|---|---|
| Success / present / paid / WhatsApp | `#E7F7EF` | `#166534` | `#15803D` |
| Late | `#FFEFE3` | `#9A3412` | `#C2410C` |
| Warning / part paid / pending / duplicate | `#FFF6DE` | `#92400E` | — |
| Danger / unpaid / absent / reject | `#FDECEC` | `#B91C1C` | `#DC2626` |
| Neutral / void / "Soon" | `#F1F5F9` | `#64748B` | — |

Note: today's `bg-green-600` and `bg-orange-500` buttons with white text are below 4.5:1; the solid values above fix that.

### 2.4 Shape, depth and motion tokens

```css
@theme {
  --radius-lg: 0.625rem;   /* inputs, buttons */
  --radius-xl: 0.875rem;   /* sections */
  --radius-2xl: 1.25rem;   /* auth card, scan result */

  --shadow-card: 0 1px 2px rgb(30 64 175 / 0.04), 0 4px 12px rgb(30 64 175 / 0.06);
  --shadow-raised: 0 2px 4px rgb(30 64 175 / 0.06), 0 12px 24px rgb(30 64 175 / 0.10);

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration-fast: 150ms;  /* hover, press, focus */
  --duration-base: 200ms;  /* menus, badges, toasts */
  --duration-slow: 300ms;  /* page fade, scan result */
}
```

Cards use `shadow-card` and a `line` border; only the auth card, scan result, toasts and the mobile menu use `shadow-raised`.

---

## 3. Icons

**Library:** `lucide-react` (one new dependency, MIT, tree-shaken so only the ~25 icons we import ship). Consistent 24px grid and stroke style; no icon font.

**Rules**
- Size 16px inline with `text-sm`, 20px in the menu and page titles; stroke width 1.75.
- Always next to a word, never alone, except the menu toggle and close buttons, which get an `aria-label`.
- Decorative icons get `aria-hidden="true"`.
- Colour follows the text (`currentColor`); no separate icon colours.
- Check vertical alignment against Sinhala and Tamil text (taller glyphs): use `inline-flex items-center gap-2`, not baseline alignment.

**Mapping**

| Place | Icon |
|---|---|
| Menu: Overview / Scan / Students / Classes / Timetable / Attendance / Fees / Slips / Reports / Settings | `LayoutDashboard` / `ScanLine` / `Users` / `BookOpen` / `CalendarDays` / `ClipboardCheck` / `Wallet` / `Receipt` / `BarChart3` / `Settings` |
| Header: menu, institute switcher, log out | `Menu` / `X`, `Building2`, `LogOut` |
| Status: Present / Late / Absent | `CheckCircle2` / `Clock` / `XCircle` |
| Status: Paid / Part paid / Unpaid / Void | `CheckCircle2` / `CircleDashed` / `AlertCircle` / `Ban` |
| Slip waiting / rejected | `Hourglass` / `XCircle` |
| Buttons: WhatsApp, Print, Add, Search, Upload, Live class link | `MessageCircle`, `Printer`, `Plus`, `Search`, `Upload`, `Video` |
| Back links and week navigation (replace `←` `→`) | `ChevronLeft` / `ChevronRight` |
| Empty states | the section's menu icon in a 48px `accent-sky` circle |
| Errors / success inline | `AlertTriangle` / `CheckCircle2` |

---

## 4. Transitions

CSS only (Tailwind `transition-*` utilities plus a few `@keyframes` in `globals.css`). No animation library.

| Where | Motion | Duration |
|---|---|---|
| Buttons, links, menu items | colour/background change; buttons `active:scale-[0.98]` | fast |
| Inputs | border and ring fade in on focus | fast |
| Cards that are links (overview tiles, class cards) | `shadow-card` → `shadow-raised`, lift 1px | base |
| Sidebar active item | background pill fades in | base |
| Mobile menu | fade + slide down 8px; backdrop fades | base |
| Page content | fade + rise 4px when the route changes (key `<main>` by pathname) | slow |
| Scan result panel | scale 0.96 → 1 + fade; colour matches status | slow |
| Toast | slide up + fade in, auto-hide after 3 s, fade out | base |
| Skeleton rows | gentle shimmer (`surface-soft` → `line` → `surface-soft`) | 1.4 s loop |
| Two-step confirm button | width/colour change into the red confirm state | base |
| `<details>` sections | chevron rotates 90° | base |

**Reduced motion:** one global rule turns movement off and keeps instant state changes:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Only `opacity` and `transform` are animated (cheap on low-end Android phones); never width/height of large areas.

---

## 5. Component updates (`components/ui.tsx`)

| Component | Change |
|---|---|
| `Button` | Add `variant` (`primary`, `secondary`, `danger`, `whatsapp`, `ghost`), `size` (`sm`, `md`), `full` (default `false`), optional `icon`. `busy` shows a small spinning `Loader2` and keeps the label. Replaces every hand-written button class. |
| `Field` | `line-strong` border, `surface` bg, focus: `primary` border + `primary-ring` ring with transition. Optional leading icon (search). Add `Select` and `Textarea` with the same look. |
| `Card` | `rounded-2xl`, `shadow-raised`, white on the auth page's soft blue wash. |
| `card` class (instead of a `Section` component) | `rounded-xl border-line bg-surface shadow-card`, exported from `components/styles.ts`; screens add their own padding and heading icon. |
| `Badge` (new) | `rounded-full px-2.5 py-0.5 text-xs font-medium` + status icon + word, using the §2.3 colours. One `status` prop. |
| `FormError` / `FormSuccess` | Soft danger / success panel with icon; same shape for both. |
| `Spinner` → `Skeleton` | `Skeleton` rows for lists and tables; `Spinner` keeps `role="status"` and gets an animated icon for small waits. |
| `Toast` (new, small) | One context + `useToast()`; used for saves ("Saved", "Link copied"). Inline messages stay for errors. |
| `EmptyState` (new) | Icon circle, one line of text, optional action button. |
| `LanguageSwitcher` | Native select styled like `Field`, with `Languages` icon. |

---

## 6. Shell and key screens

**Shell** (`dashboard-shell.tsx`)
- Header: white, `line` bottom border, subtle shadow when the page is scrolled. Institute switcher with `Building2` icon.
- Sidebar: white, icons + labels, active item = `primary-soft` pill with `primary` text; hover = `surface-soft`.
- Keep the shell on screen while page data loads (fixes the "whole page waits" gap); only the content area shows skeletons.
- Mobile menu: same items with icons, slide/fade in, focus moves into the menu and back to the button on close.

**Auth pages** (landing, login, signup, join, onboarding): soft top-to-bottom wash `canvas` → `accent-sky`, centred white card with `shadow-raised`.

**Overview**: stat tiles (today's classes, received today, slips waiting, not paid) with icon, big mono number, link. Pairs with the "Staff overview" gap in UI_UX.md §11.

**Scan**: large result panel in the status pastel, big status icon, name, time; pop-in motion; WhatsApp button below.

**Lists and tables**: `surface-soft` header row, row hover `surface-soft`, `Badge` for every status, sticky header in Reports tables.

**Printing**: `print:` resets shadows, backgrounds and icons to plain; receipts and cards stay black on white.

---

## 7. Rollout (each phase ships on its own)

| Phase | Work | Files | Done when |
|---|---|---|---|
| **1. Tokens** | Add §2 tokens and the reduced-motion rule to `globals.css`. No visual change yet. | 1 | Build passes; utilities like `bg-primary` work. |
| **2. Primitives** | Update/add components in §5; install `lucide-react`. | `ui.tsx`, `package.json` | Every primitive has every variant; one screen uses them as a test. |
| **3. Shell** | Icons, active pill, mobile menu motion, shell stays visible while loading. | `dashboard-shell.tsx`, `loading.tsx`, `language-switcher.tsx` | Checked at 375px and 1280px in all 3 languages. |
| **4. Screens** | Replace raw colour classes using the table in §8, swap hand-written buttons for `Button`, statuses for `Badge`, add empty states and icons. Do one folder per commit (attendance, classes, fees, students, settings, then the rest). | ~35 files | `grep -rE '(indigo\|zinc\|slate)-[0-9]' src` returns nothing. |
| **5. Feedback** | Skeletons on lists, toast for saves, scan result motion, two-step confirm on every removal. | page components | Every list has a skeleton; every removal is two-step. |
| **6. QA + docs** | Contrast check, phone widths, print preview, reduced motion, screen reader pass on scan + menu. Update UI_UX.md §5, §6 and §12. | docs | Checklist in §9 all ticked. |

Phases 1–3 are low risk and change the feel most; phase 4 is the bulk and is mostly mechanical.

---

## 8. Class migration table (phase 4)

| Old | New |
|---|---|
| `bg-[#f8fafc]` / body bg | `bg-canvas` |
| `bg-white` (surfaces) | `bg-surface` |
| `bg-zinc-50`, `bg-zinc-100` | `bg-surface-soft` (or `bg-neutral-soft` for void/"Soon") |
| `border-zinc-200`, `border-zinc-100`, `divide-zinc-100` | `border-line`, `divide-line` |
| `border-zinc-300` | `border-line-strong` |
| `text-zinc-900` | `text-ink` |
| `text-zinc-600`, `text-zinc-700` | `text-ink-muted` |
| `text-zinc-400`, `text-zinc-500` | `text-ink-subtle` |
| `bg-indigo-600` / `hover:bg-indigo-700` | `Button variant="primary"` (or `bg-primary` / `hover:bg-primary-hover`) |
| `text-indigo-600`, `text-indigo-700` | `text-primary` |
| `bg-indigo-50` | `bg-primary-soft` |
| `focus:border-indigo-600 focus:ring-indigo-200` | `focus:border-primary focus:ring-primary-ring` |
| `bg-green-600` (WhatsApp/approve) | `Button variant="whatsapp"` |
| `bg-green-50` / `text-green-700/800` | `bg-success-soft` / `text-success` |
| `bg-amber-50` / `text-amber-700…900` | `bg-warning-soft` / `text-warning` |
| `bg-orange-*` | `bg-late-soft` / `text-late` / `bg-late-solid` |
| `bg-red-50/100` / `text-red-600…800` / `bg-red-600` | `bg-danger-soft` / `text-danger` / `Button variant="danger"` |

Current counts: `text-zinc-500` 73, `border-zinc-300` 55, `border-zinc-200` 35, `text-zinc-600` 27, `text-indigo-600` 23, across 35 files.

---

## 9. QA checklist

- [ ] All text ≥ 4.5:1 contrast, large text and icons ≥ 3:1 (check badges and solid buttons especially).
- [ ] No sideways scroll at 360px; icons do not push actions off-screen.
- [ ] Sinhala and Tamil: icons line up with text; longer labels still fit in the sidebar (240px).
- [ ] Reduced motion on (macOS and Android): nothing slides or shimmers.
- [ ] Animations smooth on a mid-range Android phone (Chrome DevTools 4× CPU throttle).
- [ ] Print preview of receipt and class cards: no shadows, tints or icons.
- [ ] Keyboard: visible focus ring on every control; mobile menu traps and returns focus.
- [ ] Screen reader still announces scan results and errors; decorative icons are silent.
- [ ] `lucide-react` adds < 15 kB gzipped to the largest page (`next build` output).

---

## 10. Rules for new screens (replaces UI_UX.md §12 items 3–4 once shipped)

1. Use tokens only (`bg-primary`, `text-ink-muted`…); never raw Tailwind colours.
2. Use `Button`, `Badge`, `Section`, `EmptyState` from `ui.tsx`; no hand-written button classes.
3. Every status shows icon + word in a `Badge`.
4. Motion uses the duration/easing tokens, animates only opacity and transform, and must look fine with reduced motion on.
5. Icons are from `lucide-react`, 16/20px, paired with a word.
