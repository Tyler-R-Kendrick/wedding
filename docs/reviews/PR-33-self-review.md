# PR 33 — the approved Botanical–Deco design, built as the default

Sara and Tyler approved four page designs (Home, Our Story, Explore CAA + Chicago,
Your Weekend). `main` still served the earlier Gilded Hour proposal. This PR builds
the approved design as the only guest-facing theme and moves the companion pages
onto the same shell. Two independent design reviews ran on the result, and this
document records what they found and where each finding ended up.

## 1. What a hostile reviewer would say

*"The portraits are low-resolution crops of the mockups. You shipped the mockup."*

Partly true, and recorded as such. Every portrait and painted flower is an
`interim: true` crop of an approved reference, at that image's native resolution.
The replacement briefs are in `docs/design/approved-botanical-deco/media-briefs.md`.
No authorised image provider was available: Higgsfield needs an OAuth sign-in, and
the configured fal.ai token is rejected. **Media parity is incomplete** and the PR
says so. What is not a crop: the building and city photographs (openly licensed,
credited on `/credits`), the map (drawn from coordinates) and every word on every
page (live text, never baked into an image).

*"You softened the approved design wherever it was inconvenient."*

Every departure is in `parity-exceptions.json` with its reason (PX-01…PX-24). Each
reason is either a fact correction (the mockups invented a schedule, a hotel block
and a table number) or an accessibility floor: 17px for anything a guest reads or
operates (PX-22), WCAG AA contrast (PX-23), and one-module-per-row on the Weekend
because two-up cards at 17px broke their own links a word per line (PX-24).

*"A demo recording is marketing, not evidence."*

The recordings are the running site: webreel against a production build,
agent-browser against the test server. `docs/ops/demos.md` records three traps
found while making them. One was the recorder's own colour-range bug, which turned
the cream paper white. The GIFs in the PR body are the same files as in
`docs/demos/`.

## 2. Review findings and where they went

Review A (Home + Story) scored Design 6 · Usability 6 · Creativity 8 · Content 5.
Review B (Explore + Weekend + companion spot-check) scored 6/7/7/6 and 5/6/6/7.
Both said *fix first*.

**Fixed and re-measured.** Measured means a probe, test or screenshot, not a reading
of the diff.

| Finding | Fix | Measured by |
|---|---|---|
| Story portrait and spread collide at 1100–1280 | Three-column spread only from 1280px | screenshots at 1100/1280/1448 |
| Journey tabs read "Love Love"; the reader said "Chapter 2 of 7" | Kicker removed from tabs; a real tab list with arrow keys, steps and deep links | `tests/e2e/explore.spec.ts` (reader and no-script tests, 3 viewports) |
| Band and schedule wrap badly at 1100 | Tablet band layout below 1280; the schedule is one dated day block | screenshots; band words ≥ 13.8px |
| Footer on the wrong ground, motto missing, map icon on its own line | Paper ground, the approved motto, `.bd-external` inline | screenshots |
| Place tiles were not links | Chicago → `/explore-caa`, Starved Rock → its adventure, Places ahead → `/share-an-adventure` | `tests/e2e/links.spec.ts` |
| Internal notes shown to guests ("Tyler's brief 2026-09-04", "kit figures", "venue kit") | Provenance reads "From Sara + Tyler"; capacity note and rooms line rewritten | `tests/unit/truth/site-self-claims.test.ts` now fails on "kit" in guest fields |
| Map: stale focus halo, hover clears the chosen pin, 13.8px labels, Riverwalk label across the river, unlabelled Navy Pier strip | Chosen vs hovered state; labels at the body-sm step; Riverwalk label below its pin; Navy Pier named | screenshots; aria-pressed probe |
| Controls wrapping ("Review your / answers", "Getting / there", "Our Chicago / guide") | Tighter tracking; strip padding; container queries on the fieldset and itinerary; modules one per row (PX-24) | `.data/tmp/wraps.mjs` probe at 390/768/1024/1280/1440. What still wraps does so in balanced lines where the column is narrower than the label (listed in §3) |
| Printing Your Weekend: six pages, blank form first, "(/)" after the monogram | Itinerary first with details open, the reply as a status line, no colour hero; URLs printed only for external links; moss and ink bands print ink on paper; every story chapter prints | print-media screenshots; `beforeprint` probe (6/6 chapters shown, 1/6 after) |
| Straight quotes (18 straight vs 6 curly on Explore) | `curlyQuotes()` inside `guestText`, the one function every guest string passes through | unit test with apostrophes, opening/closing, abbreviated years |
| Spaces grid 3+1; outlet cards repeating three chips each | Spaces four across (two by two on tablets); outlet lists flow in columns; provenance as one quiet line via new `--prov-badge-*` slots (defaults unchanged for the other designs) | screenshots; `[data-freshness]` e2e still passes |
| Deep Gold small text at 4.39:1 | Bronze for small gold-toned text (PX-23) | axe 0 violations at 390/768/1440 |
| Detector findings | `impeccable detect` exit 0 on 10 routes; four rules waived with reasons in `detector-waivers.md` | URL scans |

**Kept, with the reason.**

| Finding | Why it stays |
|---|---|
| S15 — masthead has no RSVP/Weekend link while the window is open | Navigation follows the lifecycle state. The review environment was TEASER with the window opened by hand, a combination production does not reach. |
| S18 — "Draft — not yet curated" on an adventure | A deliberate honesty guarantee from an earlier level; `tests/e2e/explore.spec.ts` asserts it. |
| #27 — the TEASER phone bar repeats the menu instead of Directions | The design doc gives TEASER no sticky actions; RSVP and Directions arrive with RSVP_OPEN. `tests/unit/themes/lifecycle.test.ts` pins this. |
| The "seed" sentence in the connection chapter | Couple-authored copy. Rewriting it would be inventing their words. |
| Explore outlet provenance per row | Kept, now as one muted line: the e2e test and ADR-0011 require the freshness date on every sourced fact. |

## 3. What still is not right

- **Media parity** (above): interim crops until an image provider is authorised.
- A few labels still wrap into two balanced lines where their column is narrower than
  the label at 17px: "See the full schedule" in the band's intro column,
  "Explore our favorite places" on phones and in the 22% places column, "Our
  Chicago guide" below 1440px, and "See the weekend" at 768px. Placement follows the
  approved images; the alternative is smaller type, which PX-22 rules out.
- Map labels scale with the drawing: at 1100–1279px the map column is narrow and they
  render below 14px. They duplicate the list beside the map and are hidden from
  assistive tech.

## 4. Pre-merge code review

An independent adversarial code review of the whole diff ran before merging, looking for what
would break or leak in production. It found **no blockers**: no guest data reachable anonymously,
the test-principal gate untouched, `/credits` built only from committed, bundled JSON, no new
`dangerouslySetInnerHTML` or redirect sinks, and hydration-safe client components. What it did
find, and where it went:

| Finding | Resolution |
|---|---|
| A `?theme=gilded-hour` link kept a guest on a rejected design for a year (the switcher is off, so nothing leads back) | Only the approved design is stored as a lasting cookie; a proposal is remembered for the session. Unit and e2e tests. |
| Curly quotes broke placeholder sentence splitting: a settled sentence opening with “ was shown as "still writing this" | The splitter recognises “ and ‘. Test fails on the old splitter, passes on the new. |
| `site_status` reported a pre-approval database's raw `defaultTheme: gilded-hour` beside `theme.active: botanical-deco` | It reports the effective default and list. Integration test with a legacy row, as production has. |
| `navigate_to` described only the two proposals to AI and WebMCP clients | Describes the approved default and the proposals. |
| A test comment claimed unit coverage for the switcher action | Comment corrected to what is covered. |
| `/trip` gave this design Gilded Hour's eyebrow class | `bd-eyebrow`. |
| Home said "Where we will say “I do.”" and "See you in Chicago" in every lifecycle state | Past tense and no sign once the site is in its "remember" mode; no new copy invented. The "still writing this" label on the times and rooms stays in every state: it is still true afterwards. A first attempt hid it, and `tests/ui/home.test.tsx` (every state marks its unknowns) caught that. |
| Portrait alt text described generated images as scenes, as if photographs | Every alt now begins "Generated portrait of…", matching `/credits`. |
| After an inline RSVP on Your Weekend, the page's badges stay stale until reload | **Follow-up.** Refreshing would replace the confirmation (which restates the answers and the e-mail) with the summary; the answers are saved correctly either way. |

Production note: capacity notes live in the database, seeded before this PR, and the seed never
overwrites. On kendrick.wedding they keep the old "kit figures" wording until edited in
`/admin/content`; the code, the seed and the tests carry the new wording.

## 5. Validation (local, on the final head)

See the PR description's table: typecheck, eslint, `npm run quality`, 748 unit/UI
tests, 267 integration tests, every production Playwright spec on a fresh
production build (3 viewports), and the test-server specs (RSVP, seating,
typography, links).
