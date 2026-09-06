# Design review round 3 — `/rsvp` + `/your-weekend` — 2026-09-06

Branch `claude/wedding-07-rsvp-seating` @ `3a3265b`. Worktree `/home/user/wedding-07`.
Server restarted clean (`pkill next` + `rm -rf .next/dev`) before any measurement, so nothing
below is attributable to stale dev state. Guest principal = Ada Testhouse, household of three.
Both designs at 390 / 768 / 1440. No source file edited; `git status` clean at exit.

## Verdict: FIX FIRST

Scores (1–10): **Design 5 · Usability 6 · Creativity 4 · Content 5** — identical in both designs.
(Ship threshold: all ≥ 7, Usability ≥ 8 — `wedding-site-standards` §5.)

The accessibility work is now genuinely finished: **0 axe violations across 18 runs**, every target
≥ 44px, no text under 17px, 0 unlabelled controls, keyboard-complete with visible rings. That is a
real, measurable win over round 2.

Three of the seven items I was asked to verify are not fixed, and two of them were reported to me as
fixed. The most serious is that **`/rsvp` still never mentions an RSVP deadline**, and **`/rsvp` still
contradicts itself when the window is closed** — which is the state a fresh boot of this branch
serves by default.

---

## 1. Round-2 items, verified independently

| # | Item | Status | Measurement |
|---|---|---|---|
| 1 | `data-theme` server-rendered | **PARTIAL** | The attribute *is* in the server HTML now — `curl` returns `<div data-theme="gilded-hour">` on both routes in both themes, plus the RSC payload (`layout.tsx:45`). But with `javaScriptEnabled:false`, **52 of 63 text elements on `/your-weekend` and 12 of 14 on `/rsvp` compute to Times New Roman**, in both designs. Only the display headings are themed (`h1` = Cinzel 34px / Gloock 34px). Cause: `globals.css:20-25` sets `html { font-family: var(--font-text) }`, but `data-theme` sits on a `<div>` *inside* `<body>` — the variable is out of scope on `html`, the declaration is invalid at computed-value time, and everything without its own `font-family` rule inherits the initial serif. With JS on, 0 of 63 are unthemed. |
| 2 | Marker stripped at the guest boundary | **FIXED** | `grep -c 'TODO('` on the raw HTML = **0** on `/rsvp` and `/your-weekend`, both themes, open **and** closed. Round 2's three RSC-payload occurrences are gone. Scrubbed at `src/capabilities/rsvp/shared.ts:71` (`toEventView` → `placeholderHint`), which is the right boundary — admin views still see the record verbatim. |
| 3 | N1 ungrammatical placeholder copy ×10 | **FIXED** | `Placeholder.tsx:46` now appends a colon in inline mode. Read aloud from `innerText`: "Where: Sara + Tyler are still writing this: the room", "Sara + Tyler are still writing this: how to reach us with a question". They parse. The nested double colon ("Where: … this: the room") is clumsy and the slot name is stated twice — see Should fix. |
| 4 | N2 contrast 1.58:1, 9 nodes | **FIXED** | Conservatory `.placeholder__label` now computes `rgb(110,86,55)` on `rgb(234,226,206)` = **5.34:1** at 18.06px (needs 4.5:1). Gilded Hour `rgb(122,90,22)` on `rgb(237,229,214)` = **5.08:1**. axe WCAG 2.2 AA: **0 violations** in all 12 authenticated runs (2 designs × 2 routes × 390/768/1440), plus 0 in the 2 closed-state runs. Fixed by hoisting `--prov-*` from `.cv` to `[data-theme="conservatory"]` (`kit.css:22`). |
| 5 | N4 self-contradiction | **NOT FIXED on `/rsvp`** (fixed on `/your-weekend`) | With the window closed, `/rsvp` renders, in one viewport: "Saturday, July 17, 2027, at the Chicago Athletic Association Hotel. **You can change your answers any time while RSVPs are open.**" immediately followed by the notice "**RSVPs are closed**". Counted from `innerText`: `…while RSVPs are open.` ×1 and `RSVPs are closed` ×1 on the same page. `src/app/(guest)/rsvp/page.tsx:30` branches only on `data.window.deadlineAt`, never on `data.window.open`. `WeekendPage.tsx:42-49` *was* gated and is clean (×0 / ×1). **This is the default state**: a fresh boot seeds `mode: 'auto'` (`src/domain/events/seed.ts:48`) with lifecycle `TEASER`, so `computeRsvpWindow` returns `open:false, reason:'lifecycle'` (`window.ts:31`) with no admin action at all. |
| 6 | N5 bare `placeholder` class | **FIXED** (the dashed box) / **NOT FIXED** (the orphan separator) | `RsvpForm.tsx:58` is now `className="card__meta"`; `/rsvp` has exactly **1** `.placeholder` box (the footer), down from 2, and the stray full-width dashed box is gone. But round 2's second half is untouched: `WeekendPage.tsx:65` still emits an unconditional `{' · '}`. Measured node geometry at 390px on `/your-weekend`: `"Where:"` y=799 → box y=829 → **`"·"` y=903 x=41 (own line, at the left margin)** → `"Dress:"` y=903 x=51. A guest reads a line that begins "· Dress:", ×3 per page. |
| 7 | Skip link 42px, header targets | **FIXED** | `.wp-skip` measures **148×44** (Gilded Hour) / **146×44** (Conservatory) at all three widths — `recipes.css:446-448` added `display:inline-flex; align-items:center; min-height:44px`. Elements below 44px in either dimension: **0**, on both routes, both designs, all three widths. |

### Also re-measured and holding

- **0 sub-17px** text elements; **27 form controls on `/rsvp`, 0 unlabelled**; no horizontal overflow
  (scrollWidth == innerWidth at 390/768/1440); `prefers-reduced-motion` → 20/20 sampled elements at
  `0s/0s`; `noindex, nofollow` on both guest routes; tab order clean with 3px solid rings, all in view.
- `npx impeccable detect` exit **0** repo-wide and on `src/components/rsvp`, `src/components/weekend`,
  `src/components/provenance`, `src/app/(guest)`, `src/themes/conservatory`.
- `npm run quality` **green** (design:lint 0 errors / 1 info; slop:detect exit 0; stylelint clean;
  asset ledger in sync). No raw hex and no `font-family` literal in the guest CSS.

---

## 2. Collateral damage

**None found on the public pages.** This was the specific risk and it did not land.

- `/` and `/our-story`, both designs, 390px: HTTP 200, **axe 0 violations**, shell intact
  (`class="site gh"` / `class="site cv"`), `html[data-theme]` server-rendered by the kit Shell,
  `h1` Cinzel/Gloock and body Josefin Sans/Spectral, no horizontal overflow.
- The `--prov-*` hoist was safe because `.cv` and `data-theme="conservatory"` are on the *same*
  element in the public tree (`src/themes/conservatory/kit/index.tsx:164`), so the rule lands
  identically. Verified on the page that actually consumes it: `/our-story` has 7
  `.placeholder__label` nodes at **5.34:1** (Conservatory) and **5.08:1** (Gilded Hour).
  No orphan `.cv`-without-`data-theme` consumer exists (`grep` over `src/**/*.tsx`).

**One pre-existing print gap, not caused by this round.** Under `media: print` the guest nav is
still visible (`.wp-nav` left=378 w=394): `print.css:8` hides `.site nav`, and the guest tree has no
`.site` shell (`document.querySelector('.site')` → `null`). `.wp-skip` is `display:flex` but at
`left:-9999px`, so it does not print. Buttons hide correctly (`recipes.css:418`). `PRODUCT.md ›
Constraints` lists Your Weekend as a printable surface and `wedding-site-standards` §7 says print
hides nav.

---

## 3. Blockers

1. **`/rsvp` never states that an RSVP deadline exists.** Rendered `innerText`, window open: zero
   matches for `/deadline/i`. The lede (`rsvp/page.tsx:30`) and the form footer
   (`RsvpForm.tsx:155`) both fall back to "You can change your answers any time while RSVPs are
   open." — the same sentence, **printed twice on one page**. `/your-weekend` *was* fixed
   (`WeekendPage.tsx:47` renders "Sara + Tyler are still writing this: the date answers are needed
   by"), so the two pages now disagree again, in the opposite direction from round 2.
   `wedding-site-standards` §3: "Deadline is stated on the form"; §8: "RSVP deadline appears on Home
   and RSVP". → **Fix:** put the same `<Placeholder inline>` in `rsvp/page.tsx:30`, and delete one of
   the two duplicate sentences.

2. **`/rsvp` contradicts itself in the closed state, which is the default state.** "You can change
   your answers any time while RSVPs are open." directly above "RSVPs are closed". Reachable with
   zero setup on a fresh boot (`mode:'auto'` + lifecycle `TEASER`). → **Fix:** gate
   `rsvp/page.tsx:30` on `data.window.open`, exactly as `WeekendPage.tsx:44` already does.

3. **Body copy is still unthemed without JavaScript.** 52/63 elements on `/your-weekend`, 12/14 on
   `/rsvp`, in Times New Roman, in both designs — beside Cinzel/Gloock headings, so the page reads as
   two unrelated typefaces rather than as either design. `RsvpForm.tsx:20` claims the form
   "works without JavaScript", and this is also the pre-hydration first paint. The commit message says
   "theme server-side"; the attribute moved, the font did not. → **Fix:** carry `data-theme` on
   `<html>` for the guest tree, or move `html { font-family: var(--font-text) }` down to a selector
   the wrapper satisfies (`[data-theme] { font-family: var(--font-text) }`).

---

## 4. Should fix

- **The orphan `·`** — `WeekendPage.tsx:65`. At 390px it lands on its own line before "Dress:"; at
  768/1440 it stays inline but the Dress *value* wraps away from its label. Move the separator
  inside the conditional, or make Where/Dress a two-row `<dl>`.
- **Placeholder visual weight.** `/your-weekend` carries **10** dashed sand boxes (up from 9 — the
  deadline fix added one), all stamped with the same five words. Every event card is roughly half
  placeholder by area. `/our-story` solves the same problem far better with a light "DETAILS TO COME"
  chip plus a provenance line; the guest pages should borrow that treatment.
- **Double colon / repeated slot name** — "Where: Sara + Tyler are still writing this: the room"
  names the slot twice. Either drop the outer label or shorten the stamp inside a labelled row.
- **1440 chrome and content still do not share a measure.** Measured on `/your-weekend`:
  `.wp-header`/`.wp-footer` left=329 w=782; `main.page` left=291 w=857; `h1` left=307; `.wp-brand`
  left=345. The brand hangs **38px** right of the `h1`. Unchanged from round 2.
- **1440 is permitted, not designed.** One ~646px column in a 1440 canvas with a large empty
  lower-right field. `PRODUCT.md` calls 1440 "the showcase".
- **The CAA address is not a tap-to-map link** (`wedding-site-standards` §8). No `a[href]` matching
  `maps.`/`geo:` exists on either route.
- **No design switcher on the guest chrome** — `PRODUCT.md › Themes`: "switcher visible to everyone
  until chosen." The public tree has one (visible on `/our-story` as "DESIGN: CONSERVATORY"); the
  guest tree has 4 links on `/rsvp` and 5 on `/your-weekend`, none of them a switcher.
- **The two designs are still one layout in two skins.** No `gh-*` or `cv-*` kit class appears on
  either guest route, so neither theme's motif vocabulary (sunburst/chevron/stepped frames/numbered
  sections; foliage/pressed cards/organic asymmetry) reaches the pages a guest uses most — while the
  public tree renders all of it.
- **Guest nav prints** (see §2).

## 5. What is working (keep)

- Accessibility is done. 18 axe runs, 0 violations. 44px targets everywhere including the skip link.
  0 sub-17px. 0 unlabelled controls out of 27. 3px focus rings, logical tab order, all stops in view.
  `prefers-reduced-motion` fully honoured. `noindex` correct.
- The marker scrub at the capability boundary (`shared.ts:71`) is the right architecture, with a
  regression test (`tests/integration/guest-marker-leak.test.ts`).
- The `--prov-*` hoist is the correct root-cause fix and did not disturb the public tree.
- The closed-window rewrite (zero controls, not disabled controls) remains the right answer.
- Typography, where it resolves, is genuinely good: hierarchy from size and space, hairline rules,
  no slop tells, detector clean, no raw hex or font literals.
- Copy that is real is in the couple's voice: "Allergies, dietary needs, mobility or seating needs.
  We share these only with the caterer and the planner."

## 6. Scores

Both designs score identically now that the Conservatory contrast failure is gone.

| Axis | Score | Why |
|---|---|---|
| **Design** | 5 | Type and restraint are right, and `/rsvp` lost its stray dashed box. But every composition-level finding from round 2 is untouched: 10 identical placeholder boxes dominate `/your-weekend`, the "·" still orphans, 1440 misaligns chrome and content by 38px, and neither theme's own vocabulary appears. This round fixed correctness, not composition. |
| **Usability** | 6 | +1 on round 2 for finishing the a11y work, which is now measurably complete. Held below the gate by two defects that actively mislead: a guest is told there is no deadline, and in the default state is told they can still change answers on a page that says RSVPs are closed. |
| **Creativity** | 4 | +1: the placeholder that names who is writing now reads as an idea rather than a bug. Still no monogram, no `07 · 17 · 27`, no numbered sections, no foliage — all of which the public pages already have. |
| **Content** | 5 | +1 for the marker scrub and for naming the deadline gap on `/your-weekend`. The gaps are typed and honest, which is right, but ten identical stamps of the same five words read as scaffolding rather than as editorial absence — and on `/rsvp` the deadline gap is still concealed rather than named, which is a design decision, not a content gap. |

## 7. Would I ship this to 142 guests, half over 60, on a phone?

No — but it is close, and closer than the scores suggest. The hard part is done: a grandparent can
complete this RSVP with a thumb or a keyboard, at 17px, with visible labels and no contrast failures
anywhere. What stops it is not craft, it is two sentences. She would finish the form believing there
is no deadline. And if she opened the link before the couple flips the lifecycle — the default state
today — she would read "you can change your answers any time" directly above "RSVPs are closed" and
not know which to believe. Both are one conditional each in `src/app/(guest)/rsvp/page.tsx:30`.

## Evidence

- Screenshots: `…/scratchpad/r3/shots/{theme}-{route}-{390,768,1440}.png`,
  `closed-conservatory-{rsvp,your-weekend}-390.png`, `pub-{theme}-_our-story-390.png`,
  `pub-{theme}-home-390.png`, `print-your-weekend.png`, `your-weekend.pdf`.
- Raw HTML: `…/scratchpad/r3/{theme}_{route}.html` (closed, fresh boot), `open_rsvp.html`, `open_wk.html`.
- axe-core WCAG 2.2 AA: 18 runs, **0 violations** (12 authenticated × 3 widths, 4 public, 2 closed-state).
- Detector: `npx impeccable detect` exit 0 repo-wide and per-tree. `npm run quality` green.
- URL-mode detector remains blind to these routes: it cannot carry the test-auth headers, so it scans
  the signed-out page. The source scan is the load-bearing evidence.
- The RSVP window was closed once for the N4 test and **restored to `open`**; verified by re-fetch
  (`"open":true,"reason":"manual_open"`). Note that a server restart reseeds `mode:'auto'` and the
  window returns to closed — that is fixture behaviour, not a regression.

## Next command

`/impeccable polish /rsvp` — two conditionals in `src/app/(guest)/rsvp/page.tsx:30` (gate on
`window.open`; name the deadline gap with the same `<Placeholder inline>` `/your-weekend` uses) clear
both content blockers. Then one CSS selector move for the no-JS theme, and this ships.
