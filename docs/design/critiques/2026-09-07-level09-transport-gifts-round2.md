# Design review round 2 — /gifts + /transportation, both designs — 2026-09-07

Build under test: `fa56324`, production server on :3211 (verified new before judging —
`main.page` full-bleed 1440px was 857/688 centred; `--radius-button` 0px GH / 8px CV).
Viewports 390 · 768 · 1440, fresh context per measurement.

**Server note:** :3211 stalled once on a first `/rsvp` hit and recovered, then went away entirely
partway through the print re-check (no listener; an unrelated `next dev -p 3210` appeared at 02:05).
I did not start a server. Everything below was measured on :3211 while it was up, except the print
item, which is source-verified and flagged as such.

## Verdict: FIX FIRST (all four) — but every round-1 blocker is closed

| Surface | Design | Usability | Creativity | Content | (round 1) |
|---|---|---|---|---|---|
| /gifts · Gilded Hour | 6 | 7 | 5 | 5 | 5/7/5/4 |
| /gifts · Conservatory | 7 | 7 | 7 | 5 | 7/7/7/4 |
| /transportation · Gilded Hour | 6 | 8 | 4 | 7 | 4/6/3/7 |
| /transportation · Conservatory | 5 | 8 | 4 | 7 | 3/6/3/7 |

Threshold: all ≥ 7 **and** Usability ≥ 8. `/transportation` now clears Usability in both designs.
Nothing clears the full bar. **No new blockers.**

## Blocker status — measured, not taken on trust

**B1 detector — CLOSED.** `npx impeccable detect` exits **0** on all four URLs (was exit 2 with
`first-viewport-column-overflow` on both /transportation URLs). Confirmed; and yes, the browser
needs `--no-sandbox` — I ran `IMPECCABLE_BROWSER` at a wrapper script, same as round 1.

**B2 pills — CLOSED, and it propagates.** Measured `border-radius`:
| Surface | Gilded Hour | Conservatory |
|---|---|---|
| /transportation hotel-FAQ handoff | **0px** | **8px** |
| /rsvp `.btn--primary` "Find your invitation" | **0px** | **8px** |
| /your-weekend `.btn--primary` | — | **8px** |
| `--radius-button` on `<body>` | `0px` | `8px` |
Was 33554432px everywhere. `/claim` is a 404, so nothing to check there.

**B3 invented provider — CLOSED, on every surface I could reach.** Zero occurrences of
`zola|theknot|withjoy|honeyfund|amazon|crate&barrel|myregistry` in: rendered text, accessible names,
raw HTML **and the RSC flight payload** (all four URLs), and no gift-link objects in the payload at
all. The only external href left on /gifts is the footer map link. The capability response —
the concierge/WebMCP surface — is clean:
`POST /api/capabilities/list_gift_links` → `{"ok":true,"data":{…,"links":[]}}`, no provider, no URL.

**B4 Conservatory on Gilded Hour's type — CLOSED.** Re-measured per design per viewport:

| | CV token | CV /gifts (themed) | CV /transportation now | (round 1) |
|---|---|---|---|---|
| h1 390 | 2.25rem / 400 | 38.25px w400 | **38.25px w400** | 34px w500 |
| h1 1440 | — | 51px | **51px** | 34px |
| h2 390 | 1.625rem | 27.625px | **27.625px** | 25.5px |
| lede | body-lg 1.25rem | — | **21.25px** | 22.31px |

Gilded Hour /transportation: Cinzel **uppercase, letter-spacing 2.04px (0.06em)**, fluid
34 → 38.146 → 46.75 — identical to its own themed h1. Was `normal` tracking, sentence case, frozen
34px at every viewport. The layout half is closed too: CV `main` is **left-weighted** at 1440 with a
real right-hand mounting area (was left 376 / right 376, perfectly mirrored — Gilded Hour's law).

**B5 four axes per card — CLOSED.** One prose axis (x≈330 at 1440) with headings centred on the page
axis — exactly GH's "headings are centered on the page axis; body copy is left-aligned inside a
centered column". The 198px mis-registration is gone.

**B6 dead end + no switcher — HALF CLOSED, and I was half wrong.**
Switcher: present on all four surfaces in both designs. ✓
Nav: **I retract the dead-link claim.** I probed PRODUCT.md's slugs (`/story`, `/adventures`) and got
404s; the nav actually emits `/our-story` and `/our-adventures`, both **200**. No dead link in the
nav. The five items shown are `NAV_BY_STATE.TEASER` from `src/domain/lifecycle/nav.ts:35` with
`photos` removed by `NOT_BUILT_YET` — lifecycle-correct, and PRODUCT.md's own Surfaces table makes
Gifts visible from RSVP_OPEN and Transportation from INVITATIONS_OPEN. So Gifts/Transportation being
absent in TEASER is the model working, not a defect. My "navigational dead end" framing was wrong.
Residual (product question, not a bug): a guest who lands on either page in TEASER sees a nav that
does not contain the page they are on and no route to the sibling logistics page.

## Your three pushbacks

**1. Deferring the theme Shell — you are right, keep the deferral.** The substantive "unfinished"
signals were type scale, case, tracking, measure, radius, the placeholder contract, print and link
naming, and all of those are now per-design and correct. What is left (ornament, washes, fern
dividers, tag rail, elevator panel, plaques) is genuinely whole-guest-tree work, and doing one route
piecemeal would add a third navigation pattern. One thing worth knowing: **the deferral costs
Conservatory more than Gilded Hour.** Gilded Hour's identity lives substantially in type — capitals
plus tracking — which the guest kit now carries, so its /transportation reads as deliberate.
Conservatory's identity lives in ornament and ground-changes, so its /transportation is correctly
*aligned* but *unfurnished*: the left-weighted column is right, the mounting area is empty, and the
sections are still separated by six identical full-width rules and identical whitespace, which its
DESIGN.md names explicitly as the thing not to do. That is an argument for sequencing the guest tree
earlier in the quality level, not for reopening it here.

**2. My should-fix #4 (Cinzel tracking) — you are right, I was wrong.** As literally written my
recommendation would have produced tracked sentence-case Cinzel and earned the `wide-tracking`
findings you hit. Making case *and* tracking per-design role tokens is the better fix, and it
measures correctly: GH guest headings uppercase + 0.06em (matching its themed headings), CV sentence
case + normal (Gloock's token tracking is 0em).

**3. My should-fix #1 (six dead italics) — you are right about `provenance.css`, and there is a third
source neither of us had found.** `provenance.css` carries no `font-style` on `.placeholder`,
`.placeholder__label` or `.placeholder__hint`; line 88 is the comment recording its removal. My
attribution was wrong. But the *effect* is still live: computed `font-style: italic` on **12 nodes**
across /transportation, both designs, at 390 and 1440. The source is a **second, competing
`.placeholder` rule in the guest kit**:

```css
/* src/components/rsvp/recipes.css:138-141 */
.placeholder {
  color: var(--color-on-surface-muted);
  font-style: italic;
}
```

`font-style` inherits, which is why the label and hint compute italic too. Under
`font-synthesis: none` it renders roman, so the rule is dead — and in Conservatory it asks **Spectral**
for an italic, which that DESIGN.md forbids outright. It also silently overrides provenance.css's
`color: var(--color-on-surface)` with the muted tone. Your two real instances are fixed; this is a third.

**4. `.gh-eyebrow` at 13.8px — agreed, out of scope.** `label-caps` is 0.8125rem in both DESIGN.md
files, so the CSS matches the contract; whether the contract should permit 13.8px labels for this
audience is a DESIGN.md question carried from level 07, not a level-09 regression.

## What the fixes broke, or left behind

1. **Stale copy that now describes something that does not exist.** `handoffNote` — "Each link opens
   the provider's own site in a new tab. Anything you choose there is handled by them; we never see
   payment details." — still renders on /gifts, which has **zero links**, immediately above a
   placeholder saying the links are still being written. It is also in the `list_gift_links`
   response, so the concierge will tell a guest this when there is nothing to open.
   → Gate it on `links.length > 0`.
2. **Section rhythm was tuned for cards and not re-tuned after they were removed.** Measured at 1440:
   GH `.gh-section--default` height **422px** for **142px** of ink (**66% empty**, 184px lead-in);
   `.gh-section--alt` 453px for 173px. CV: 406px for 150px (**63% empty**, 160px lead-in). Whole page
   2206px (GH) / 2098px (CV) for **157 words** and **0 interactive elements in `main`**. "Art-gallery
   airy" is the brief; 184px above 142px of text is hollow, not airy. The fix is not to restore the
   fake links — it is to let the sections collapse toward their content when a section is pending.
3. **The `.todo` inline highlight fragments across line breaks** — as an inline `<span>` with a
   background it renders as two staggered filled rectangles per placeholder, the second ending
   mid-phrase. Three per page, both designs, most visible at 1440. → `box-decoration-break: clone`,
   or make it a block like `.placeholder`.
4. **Guest-kit switcher chrome is off-token in both designs.** `switcher__trigger`,
   `switcher__close`, `switcher__option` all measure **2px** on /transportation, /rsvp and
   /your-weekend, in both themes — while the `.btn--primary` beside them correctly reads 0px / 8px.
   The same buttons render 0px on the themed home page under Gilded Hour. → Point them at
   `--radius-button`.
5. **Measure still over spec on three of four surfaces** (the `rem` change fixed the fourth):
   GH /transportation **68ch** ✓ (spec 60–70, was 91); CV /transportation **76ch** (spec 55–72);
   GH /gifts **83–85ch** (spec 60–70, was 92); CV /gifts **75–79ch** (spec 55–72). The /gifts
   overruns are in the themed `Prose`, a different owner from the guest kit you fixed.
6. **GH guest h1 is left-aligned** where GH DESIGN.md says "Headings are centered on the page axis"
   (its themed /gifts h1 measures `text-align: center`). Defensible for a reading page — worth an
   explicit decision rather than an inherited default.
7. **"Ask us" is a 17×49 target** in Gilded Hour (26×50 in Conservatory) — unchanged. Passes WCAG
   2.5.8 under the inline exception, fails the project's own ≥44px bar, and it is the page's only
   help route for the audience least able to hit it.
8. **Conservatory's design-switcher button sits above the h1**, alone in a bordered box, giving
   design-switching more prominence than the page's subject.
9. Two sections still answer the same question on /transportation ("Your ride home" / "Getting home
   after the reception") — carried from round 1.

## Verified clean this round

- axe-core WCAG 2.0/2.1/2.2 A+AA: **0 violations** across 8 runs (2 routes × 2 designs × 390/1440).
- Manual contrast with effective-background walking: **0 failures** on all 8 — including every
  placeholder box and the muted-override case.
- Horizontal overflow: `scrollWidth == clientWidth` on the document at all **12** combinations, and
  **0** elements extending past the viewport anywhere.
- Text under 17px on /transportation: **0** in both designs (was 0; /gifts' 15/8 are nav, switcher
  and eyebrow chrome on `label-caps`/`label-sm` tokens — the DESIGN.md question above).
- Markers: `TODO(`, `backlog X-NN`, `planner item`, `P-NN` → **0** in rendered text and raw payload
  on all four URLs.
- **Placeholder contract now uniform and machine-checkable:** every placeholder on both pages carries
  `role="note"` and `data-placeholder="true"` — `span.todo` on /gifts (it did not before) and
  `.placeholder` on /transportation. No `sr-only`-only note anywhere; `.sr-only` content is now only
  "(opens in a new tab)" and the monogram's home label.
- **Four distinct maps link names:** "Directions to the hotel (transit) in Google Maps", "…in Apple
  Maps", "Directions to the valet entrance (driving) in Google Maps", "…in Apple Maps".
- Print chrome fix **source-verified** at `src/components/rsvp/recipes.css:470-475` — `.btn, .actions,
  .skip, .wp-skip, .wp-header { display: none }`. Not re-verified in-browser; the server went away.

## Next command

`/impeccable polish /gifts` — the remaining /gifts work is rhythm and stale copy, not structure.
Then delete the duplicate `.placeholder` rule at `src/components/rsvp/recipes.css:138`.
