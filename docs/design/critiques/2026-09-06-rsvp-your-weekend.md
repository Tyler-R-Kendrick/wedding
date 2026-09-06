# Design review — `/rsvp` + `/your-weekend` — 2026-09-06

Target: worktree `/home/user/wedding-07` (branch `claude/wedding-07-rsvp-seating`),
served at `http://localhost:3107`, principal `A1` (manager of a three-person
household: Ada / Ben / Cleo Testhouse).
Themes: `?theme=gilded-hour`, `?theme=conservatory`. Viewports: 390 / 768 / 1440.

## Verdict: FIX FIRST

Scores (1-10), **identical for both themes because both themes render the
identical bytes** (see Blocker 1):

| Axis | Gilded Hour | Conservatory |
|---|---|---|
| Design (40%) | **4** | **4** |
| Usability (30%) | **7** | **7** |
| Creativity (20%) | **3** | **3** |
| Content (10%) | **5** | **5** |

Ship threshold is all >= 7 with Usability >= 8 (`wedding-site-standards` §5).
Design, Creativity and Content fail; Usability misses the raised bar by one.

### Justification

- **Design 4.** The craft *inside* the neutral foundation is real: strict
  vertical rhythm, hairline-bordered cards, one pill CTA per screen, italics
  reserved for unresolved facts, no shadows, no gradients. But it is the wrong
  design system entirely (Blocker 1), the type renders in Times New Roman
  (Blocker 2), and at 1440 the page is a single ~620px column in a 1440px
  viewport with no desktop composition
  (`screens/.../your-weekend-A1-gilded-hour-1440.png`). PRODUCT.md calls 1440
  "the showcase"; this is a document, not a showcase.
- **Usability 7.** The strongest work in the build (see "What is working").
  Held below 8 by the closed-state dead end (Blocker 4), instructional text
  under the 17px floor (Blocker 5), and 20px-tall nav targets (Should-fix 1).
- **Creativity 3.** Nothing on either page is *theirs*. No monogram, no motif,
  no gold rule, no pressed-specimen offset — none of the five motifs
  (Adventure, Place, Memory, Hospitality, Future) appears. The only original
  gesture is italic-for-unknown, which is genuinely good and worth keeping.
- **Content 5.** Structurally complete and scrupulously honest — every slot is
  present, nothing is invented, the privacy line and the restated confirmation
  are excellent. Marked down only for the *treatment* of the placeholders
  (Blocker 6), not for the gap itself.

---

## Blockers (must fix before these pages go to guests)

### 1. Neither page is themed at all; both themes render byte-identical output
**Routes:** both. **Themes:** both. **Viewports:** all three.

All six theme pairs are identical at the byte level:

```
md5 rsvp-gilded-hour-390.png == md5 rsvp-conservatory-390.png     (IDENTICAL)
md5 your-weekend-gilded-hour-1440.png == ...-conservatory-1440.png (IDENTICAL)
```
…and so on for all 6 route x viewport pairs. Page heights match exactly
(`/rsvp` 5353px, `/your-weekend` 2762px at 390px in *both* themes).

Cause: `src/app/(guest)/layout.tsx:12` is a placeholder scaffold whose own
comment says "Swarm B's theme Shell/Nav replace it at merge". It never calls
`getRequestTheme()` and never emits `data-theme`, unlike
`src/app/(public)/layout.tsx:20-27` which does. Confirmed over the wire:

```
/?theme=gilded-hour        -> data-theme="gilded-hour"   (53838 bytes)
/?theme=conservatory       -> data-theme="conservatory"  (47523 bytes)
/rsvp?theme=<either>       -> no data-theme attribute at all
/your-weekend?theme=<either> -> no data-theme attribute at all
```

Instead the layout imports `src/components/tokens/foundation.css`, which is the
**root** `DESIGN.md` palette. `DESIGN.md:172-179` scopes that file explicitly:
"This root file is the calm, neutral foundation used by **admin screens, the dev
inbox, error pages, e-mail, and print styles**." Two guest-facing surfaces are
running the admin design system.

What is lost: Gilded Hour's "white marble ground; gold leaf as ornament … a
single vertical axis on every page" (`src/themes/gilded-hour/DESIGN.md`) and
Conservatory's "herbarium sheet … left-weighted, hand-set, layered and green"
(`src/themes/conservatory/DESIGN.md`). The two are specified as deliberate
opposites; the guest sees neither.

**Smallest fix:** make `(guest)/layout.tsx` mirror `(public)/layout.tsx` — await
`getRequestTheme()`, emit `data-theme`, preload that theme's fonts, and render
inside the theme kit Shell instead of the ad-hoc `<header>`/`<footer>`.

### 2. Theme fonts never load; every glyph is Times New Roman
**Routes:** both. **Themes:** both. **Viewports:** all three.

`document.body` computed `font-family` is `"Times New Roman"` on all 12
captures. `src/components/tokens/foundation.css:22-31` declares bare family
names with **no fallback stack and no `@font-face`**:

```css
--font-h1: "Libre Caslon Display";
--font-body-md: "Newsreader";
```

`@font-face` rules exist only in `src/themes/gilded-hour/fonts.css` and
`src/themes/conservatory/fonts.css`, neither of which the guest layout imports.
So the browser silently falls back to its default serif. This breaks
`PRODUCT.md` ("fonts self-hosted, <= 3 files per theme, `font-display: swap`
with tuned fallbacks") and means the headline face is a system font on the two
most important guest pages.

**Smallest fix:** import the active theme's `fonts.css` from the guest layout
(follows automatically from fixing Blocker 1); until then, give every
`--font-*` token a real fallback stack.

### 3. `impeccable detect` exits 2 on both routes — `kicker-above-heading`
**Routes:** both. **Themes:** both.

Against the authenticated HTML with stylesheets resolved:

```
pages/rsvp.html
  [kicker-above-heading] kicker "RSVP" above h1 "Testhouse household, will you join us?"
  [clipped-overflow-container] html clips a positioned child
  [clipped-overflow-container] body clips a positioned child
pages/your-weekend.html
  [kicker-above-heading] kicker "Your Weekend" above h1 "Your weekend, Ada"
  [clipped-overflow-container] html clips a positioned child
  [clipped-overflow-container] body clips a positioned child
9 anti-patterns found.   EXIT=2
```

The kicker is `src/app/(guest)/rsvp/page.tsx:27` (`<p class="page__eyebrow">RSVP</p>`
directly above the `<h1>` on line 28) and the equivalent in
`src/components/weekend/WeekendPage.tsx`. There is **no waiver** for
`kicker-above-heading` in `.impeccable/config.json` (waivers cover only
`cream-palette`, `src/themes/*/fonts.css`, `playwright-report/**`).

Note the tension to resolve deliberately: root `DESIGN.md:283` prescribes
"**eyebrow** — sage small-caps above every section title", which is exactly what
the detector bans. One of the two has to give, in writing.

**Smallest fix:** drop the standalone eyebrow on these two pages (the `<h1>`
already names the page, and `<title>` carries it for assistive tech), or add a
documented waiver to `.impeccable/config.json` citing DESIGN.md.

### 4. When RSVPs are closed, 23 live inputs sit above a disabled button
**Route:** `/rsvp`. **Themes:** both. **Viewport:** all, worst at 390px.

In the seeded default state (`lifecycle = TEASER`, so the window is closed —
`src/db/seed/seed.ts:54`), the page shows an "RSVPs are closed" banner and then
renders the **entire form fully interactive**: 23 `<input>`, 3 `<select>`,
6 `<textarea>`, all enabled. Exactly one element carries `disabled`:

```html
<button class="btn btn--primary" disabled="" type="submit" value="draft" name="intent">Review your answers</button>
```

A guest can therefore answer for three people across three events, choose three
meals and type dietary and accessibility notes, scroll **5383px** on a phone,
and discover at the bottom that the only button is greyed out. A disabled
button is also not focusable, so a keyboard or screen-reader user reaches the
end of the form and is told nothing. This is the "grandparent on a phone in a
car" case the brief is written around, and it is a dead end with no recovery
path beyond the banner they passed 5000px ago.

**Smallest fix:** when `window.open` is false, render the read-only summary
(the `RsvpReview` presentation already exists) instead of the form, keeping the
banner and the "reach Sara and Tyler" contact line at the top.

### 5. Instructional and status text sits below the 17px floor
**Routes:** both. **Themes:** both. **Viewports:** all three.

Measured computed sizes at 390px:

| Element | Size | Text |
|---|---|---|
| `p.fld__hint` | 15.94px | "Only needed if attending." |
| `p.fld__hint` | 15.94px | "Your invitation includes one guest. Please te…" |
| `span.badge` | 15.94px | "attending" / "not attending" / "no answer yet" / "4 of 9 answered" |
| `button.btn--primary` | 15px | "Review your answers" (the primary CTA) |
| `p.page__eyebrow` | 12.75px | "RSVP" / "Your Weekend" |

`PRODUCT.md` Constraints: "WCAG 2.2 AA, **17px minimum body text**". Root
`DESIGN.md:245` : "Body text never drops below 16px on mobile (`body-md` is
17px)." The plus-one hint and the RSVP status badges are load-bearing content,
not decoration — the badges are the entire answer to "did Ben reply?" — and the
primary CTA label is the smallest interactive text on the page.

**Smallest fix:** promote `.fld__hint` and `.badge` from `body-sm` to `body-md`
(17px) and raise the `.btn` label to at least 16px.

### 6. The literal string `TODO(Tyler & Sara)` is rendered to guests, doubled
**Routes:** both. **Themes:** both. **Viewports:** all three.

15 occurrences in the `/rsvp` HTML; 9 in `/your-weekend`. Each event card on
`/your-weekend` reads:

> Saturday, July 17, 2027 · Time to be confirmed — TODO(Tyler & Sara)
> Where: *room to be confirmed — TODO(Tyler & Sara)* · Dress: *to be confirmed — TODO(Tyler & Sara)*

The brief is right that the gap itself is not a mark-down, and the *editorial*
half is genuinely well handled: "Time to be confirmed", "room to be confirmed",
set in italic, is exactly the intentional treatment asked for, and the empty
states "Your table will appear here once seating is published" and "Ride and
valet details will appear here once they are set" are excellent.

The failure is the **suffix**. `TODO(Tyler & Sara)` is developer syntax with a
parenthesised owner list; appending it to an already-complete human phrase says
the same thing twice, the second time in a register that reads as a bug. A
guest over 60 seeing "TODO" on three cards will conclude the site is broken.
`wedding-site-standards` §8 also gates shipping on "No `TODO(Tyler & Sara)`
left on a shipped page".

This is also the root cause of the detector's advisory
`[em-dash-overuse] 12 em-dashes in body text` on `/rsvp` — the em-dash is the
joint in the doubled construction.

**Smallest fix:** keep the italic human phrase in the rendered output and move
the `TODO(Tyler & Sara)` marker to a non-visible authoring channel (the content
record's status field), so the guest sees "Time to be confirmed" and the couple
still sees an unfilled slot in admin.

---

## Should fix

1. **Nav and skip-link tap targets are 20-25px tall.** `/rsvp` and
   `/your-weekend`, both themes, 390px. Measured: "Sara + Tyler" 88.8x20,
   "Your Weekend" 106.2x20, "RSVP" 45.2x20, "Skip to content" 103x25.5. The bar
   is >= 44x44 (`wedding-site-standards` §7). These live in the placeholder
   layout `src/app/(guest)/layout.tsx:20-31`, so Blocker 1's fix likely removes
   them — but if the scaffold survives, pad the links.
   *(The form's own controls are fine: `label.choice__opt` wraps each radio and
   measures >= 44px tall. My first pass measured the 22x22 `<input>` and was
   wrong; the effective target is the label.)*
2. **`/your-weekend` hides the deadline entirely when it is unset**, while
   `/rsvp` shows "Deadline TODO(Tyler & Sara)".
   `src/components/weekend/WeekendPage.tsx:40` renders the deadline only when
   `deadlineAt` is non-null; `src/components/rsvp/RsvpForm.tsx:153` falls back to
   a visible placeholder. The slot exists and will populate correctly — but the
   two surfaces disagree about what "not yet known" looks like. Make Your
   Weekend use the same visible pending treatment.
3. **"Saturday, July 17, 2027" appears five times on `/your-weekend`** (lede,
   three event cards, footer) while the facts that actually differ between the
   three events — time and room — are the ones missing. Move the shared date to
   the page header and let the cards carry only what distinguishes them.
4. **1440px is the 390px column stretched.** `/your-weekend` at 1440 is one
   ~620px column with a large empty band below the fold; `/rsvp` at 768 and
   1440 are byte-identical (4780px tall at both). PRODUCT.md: "390px is the
   design canvas; **1440px is the showcase**." There is currently no desktop
   composition to show.
5. **Tailwind's stock `animate-bounce` keyframes ship in the guest CSS bundle.**
   The detector flags `[bounce-easing]` three times in
   `_next/static/chunks/…globals….css` (lines 124, 5349, 5350). Not an authored
   violation — `grep -rn 'animate-bounce' src` returns nothing — but it means a
   detector run against built output will always fail. Prune the unused
   utility or add a build-output ignore.

---

## Consider

- `/rsvp` is 5353px of continuous scroll at 390px for a three-person household
  (9 attendance decisions, 3 meals, 6 note fields) with no progress indicator,
  no section jump-list, and no save-as-you-go. It is *correct* and it is a lot.
  A per-person accordion, or a "3 of 9 answered" counter pinned as the guest
  scrolls, would cut the perceived length without changing the model.
- The `@media print` block (`src/components/rsvp/recipes.css:412-426`) hides
  `.btn`, `.actions` and `.skip` but not the `<nav>`, so a printed Your Weekend
  carries "Sara + Tyler (/) Your Weekend (/your-weekend) RSVP (/rsvp)" across
  the top.

## What is working (keep)

- **The RSVP interaction model is the best work in this build.** Fill → "Please
  check your answers" ("Nothing is saved yet. Confirm below, or go back to
  change anything.") → "Thank you — you are all set", which restates every
  answer per event per person, names whose notes were recorded, adds "Only the
  caterer and planner see them", and hands off with "See your weekend". That is
  `wedding-site-standards` §3 satisfied in full.
- **axe-core: 0 violations** on both routes at 390px (wcag2a, wcag2aa, wcag21a,
  wcag21aa, wcag22aa).
- **Keyboard-complete.** 70 tab stops traversed; every real control is
  reachable and every one carries a visible 3px `#5C6B57` focus ring. The only
  outline-less stops are the Next.js dev portal and `<body>`.
- **Error handling is textbook**: an error summary that receives focus
  ("Please check a few things / Please check the highlighted fields") plus
  inline per-field text ("Please choose a meal.") plus `aria-invalid`, and
  nothing is persisted until confirm.
- **Semantics**: 9 `<fieldset>`/`<legend>` pairs, one per person per event; every
  input has a visible `<label>`; no placeholder-as-label anywhere.
- **Plus-one is correctly entitlement-gated.** Household A has
  `plusOnePolicy: 'none'` on all three events (`src/db/seed/fixtures.ts:51`) and
  shows no plus-one UI; principal B1, who has `'named'` on the reception
  (`fixtures.ts:54`), gets a checkbox and the hint "Your invitation includes one
  guest." Correct in both directions.
- **Token discipline is clean.** Every raw hex is confined to the token
  definitions in `foundation.css:8-21`; components reference `var(--font-*)` and
  `var(--color-*)` only. `npm run quality` is green (design:lint 0 errors,
  slop:detect over `src/` clean, stylelint clean).
- **Motion is exactly right**: one 200ms `ease-out` border-colour transition,
  correctly wrapped in `@media (prefers-reduced-motion: no-preference)`
  (`recipes.css:405-410`). No bounce, no stagger, nothing decorative.
- **Print styles** hide chrome and expand `a[href]` to full URLs, per
  `wedding-site-standards` §7.
- Honest empty states and italic-for-unknown are a genuinely good idea; keep
  them when fixing Blocker 6.

## Evidence

- Screenshots (16): `docs/design/critiques/screens/2026-09-06-rsvp-your-weekend/`
  — `{rsvp,your-weekend}-A1-{gilded-hour,conservatory}-{390,768,1440}.png`,
  `rsvp-B1-gilded-hour-390.png` (plus-one case),
  `rsvp-step-review-or-error.png`, `rsvp-step2-review.png`,
  `rsvp-step3-confirmation.png`.
- Detector, authenticated HTML + mirrored CSS: **exit 2**, 9 anti-patterns —
  `kicker-above-heading` x2, `clipped-overflow-container` x4,
  `bounce-easing` x3 (bundle only); advisory `em-dash-overuse` x2.
- Detector, live URL unauthenticated: **exit 2**, `kicker-above-heading` on the
  `GuestsOnly` gate ("Invited guests" above "RSVP is for invited guests").
- axe-core WCAG 2.2 AA at 390px: **0 violations**, both routes.
- `npm run quality`: green.
- Theme diff: all 6 route x viewport pairs byte-identical (md5).

### Method notes / limits

- The seeded lifecycle is `TEASER`, so the RSVP window is closed by default.
  Blockers 1-3, 5, 6 were observed in **both** states. Blocker 4 is by
  definition the closed state. The open-state review (form, error, review,
  confirmation) was done after opening the window via
  `admin_set_rsvp_window {mode:'open'}`; that call succeeds through Playwright's
  request context (`tests/e2e/rsvp.spec.ts:18`) but returns `unauthenticated`
  over plain curl — I did not chase the difference, and it is not a finding.
- The detector cannot send auth headers, so the URL run only ever sees the gate
  page. The authenticated run was done by saving the rendered HTML and
  mirroring its three CSS chunks. An earlier run without the CSS reported
  `flat-type-hierarchy` (all roles 16px) — that was an artifact of unresolved
  stylesheets, **not** a real finding, and is excluded above.
- The dark circular "N" badge at the left edge of several screenshots is the
  Next.js dev-tools indicator, not a product element.
- Core Web Vitals / Lighthouse were not run: this is a Turbopack dev server, so
  LCP and CLS numbers would not be meaningful.

## Most valuable next command

```
/impeccable polish src/app/(guest)/layout.tsx
```
Fixing the guest layout to resolve and apply the theme (Blockers 1 and 2, plus
Should-fix 1) is the single change that moves Design and Creativity most; do it
before touching anything cosmetic, because every visual judgement above is
provisional until these pages are rendering in an actual theme.
