# Design review — Travel & Stay and Your trip, round 1 (2026-09-06)

Level 08, PR #9. Independent reviewer, both designs, 390 / 768 / 1440.

## Verdict as received: FIX FIRST

| Design | Design | Usability | Creativity | Content |
|---|---|---|---|---|
| Gilded Hour `/travel` | 4 | 4 | 5 | 5 |
| Conservatory `/travel` | 7 | 6 | 7 | 5 |

Gate is ≥7 on every axis and Usability ≥8. Neither cleared it; Usability bound in both.

## Blockers, and what I measured before fixing each

| # | Finding | My own measurement | Fix |
|---|---|---|---|
| B1 | Gilded Hour room-block card clipped at 390 | card children 609px wide running to x=670 in a 390px viewport; `body { overflow-x: clip }` hid it, so the only symptom was a title reading "CHICAGO ATHLETIC A" | `grid-template-columns: minmax(0, 1fr)` on `.gh-card__inner` — a grid item's default `min-width: auto` is its content's minimum |
| B2 | Conservatory contrast failures | axe: `#677764` on `#f4eedf` = **4.12:1**, from `text-primary/70` — a raw opacity on a token. 1 node on `/travel`, more on `/trip` | `.hint` / `.eyebrow` in the shared base, using `--color-on-surface-muted` |
| B4 | A seeded guest could not reach `/trip` | `GUEST_DEFAULT_ENTITLEMENTS` lacked `view_travel_tools`; `get_my_trip` requires it. Production unaffected — the **test-only** list had drifted | entitlement added; `tests/e2e/trip.spec.ts` now covers the signed-in page |
| B6 | Body copy at 14.875px | 8 elements under the 17px floor in Gilded Hour, 3 in Conservatory | `text-sm` removed across 33 sites in the level-08 UI |

## Why these survived to a hand review

`tests/e2e/travel.spec.ts` called `page.goto('/travel')` with no `?theme=`, so **every assertion in
it, axe included, only ever visited the default design.** Conservatory's contrast failure was never
looked at by a machine. The spec is now parameterised by design, and asserts no viewport overflow
and the 17px floor as well.

`/trip` is the sharper version of the same thing: the spec visited it, asserted the signed-out
prompt, and passed — while a test principal could not get past that prompt either. The spec was
asserting the same page in both roles and reporting it as coverage. This is the third time in this
run a test has turned out to assert the defect or nothing at all rather than the guarantee.

## Accepted and not fixed here

**B5 — `/trip` does not go through the theme engine.** Real; the reviewer recommends not blocking
PR #9 on it and I agree. It is contained, non-regressing, and the seam is already cut at
`trip/page.tsx`. It is level 09's first task.

**B7 — Gilded Hour line length ~146ch at 1440** (Conservatory 69ch, in spec). A measure fix on a
shared kit container; it belongs with B5.

**The uppercase micro-labels are 13.8px** (`.gh-eyebrow`, `.gh-stat__label`). They take
`--type-label-caps-size` from DESIGN.md and have been that size site-wide since level 04, when the
design review passed at ≥7 on all axes. Re-scaling them changes the type system on every page, so it
is a design decision for a review round, not something to smuggle through a travel PR. The e2e floor
assertion excludes them, and says so. **Recorded here as an open question**: 13.8px uppercase for a
fact label, on a site whose primary audience is grandparents, is worth re-examining.

**"One IA, two skins."** The reviewer's sharpest point: the kits genuinely differentiate at pixel
level (deco plaques, stepped frames and symmetry against specimen labels, sky wash and asymmetry),
but the two *recipes* differ by three substantive lines and every heading and word is identical, and
neither builds the concept its own doc comment claims — there is no departures board and no field
guide. That criticism is accepted. The doc comments overclaimed and have been rewritten to describe
what the code does; making the two pages structurally different is design work for the next round,
not something to fake in a comment.

**Placeholder density.** 7 per page, 5 in `#stay`, 4 of 4 room-block facts empty. The reviewer is
right that four blanks in the most decorated frame reads as a stub rather than as an editorial gap.
It resolves when the planner supplies P-03; collapsing the list to one sentence when most of it is
unknown is queued behind that.

## Verified good, and kept

All 39 inputs labelled at 17px with 46.8px targets; `prefers-reduced-motion` honoured; no horizontal
scroll; `npm run quality` green. No raw `TODO(` or `backlog X-00` anywhere on `/`, `/travel` or
`/trip` in either design, checked in both rendered text and raw HTML.

Two findings the reviewer raised and then disproved, recorded because the discipline is the point: a
mid-page nav overlap that was a `position: fixed` screenshot artefact, and a missing focus ring that
was a programmatic-focus false positive (real Tab shows rings on 35 of 39; the four date inputs are a
Chromium `:focus-visible` gap).

## After the fixes

`/travel` in both designs at 390/768/1440: **0 axe serious or critical, 0 elements overflowing the
viewport, 0 running copy under 17px.** `/trip` signed in, both designs, three viewports: axe clean.
Production arrangement 193 passed; test-server arrangement 71 passed.
