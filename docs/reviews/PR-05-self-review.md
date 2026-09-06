# Self-review — PR 05 `story-caa`

| Field | Value |
|---|---|
| Branch | `claude/wedding-05-story-caa` |
| Base | `claude/wedding-04-themes-lifecycle` (level 04, PR #5) |
| Reviewer | integrator, over Swarm C's content layer and Swarm B's themed recipes, plus one independent `design-reviewer` round and the integrator's own verification probes |
| Date | 2026-09-06 |
| Commands run | `NEXT_TURBOPACK_ROOT=/home/user npm run verify`, `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` against `next start`, live anti-slop detector on 18 page/design combinations, integrator blocker probes (`.data/verify/check.mjs`), secrets grep, TODO inventory |

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | "Nine pages and the Content axis still scores 3–7." True and by policy: every unknown is a visible placeholder, nothing invented. Backlog C-01/C-02/C-07/P-01/P-02 gate it, and those are the couple's to close. | should | Accepted; nothing fabricated in 18 page reads (independently confirmed) |
| 2 | The swarm scored its two designs within 0.2 of each other on every page — self-grading converged. | should | Independent review re-scored: Conservatory is stronger on 8 of 9 pages. Its numbers are now the scores of record in all 18 critique files; the swarm did not re-score itself |
| 3 | **Internal ticket identifiers printed to guests** — 24 instances, 11 on `/the-wedding` | blocker | Fixed `dc6045b`: `guestText()` scrubs them as copy becomes a view, and both kits scrub the raw strings that never pass through a text block. Integrator probe: **0 across all 18 combinations** |
| 4 | **Conservatory's floating Menu tag occluded content at scroll offset 0** on two pages; `main` reserved 0px where Gilded Hour reserved 72.25px | blocker | Fixed `dc6045b`: one reservation mechanism in `base.css` for both a full-width bar and a floating control. Integrator probe: GH **72.25px**, CV **89.25px** on every page |
| 5 | **`/share-an-adventure` was 22,628px with categories at the same heading level as their places** and two duplicate headings | blocker | Fixed `dc6045b`: categories one level above their places, counts make them unique, both designs open with a jump list. Integrator probe: **0 level skips, 0 duplicate names** |
| 6 | **`/explore-caa` hid the external-link affordance inside 13 headings** and never named the provider | blocker | Fixed `dc6045b`: the heading is the outlet name alone; the link is its own 44px control naming its destination. Integrator probe: **0 affordance strings inside headings** |
| 7 | **Gilded Hour centred multi-line body copy** against its own DESIGN.md | blocker | Fixed `dc6045b`. Integrator probe: **0 centred multi-line paragraphs inside `main`**; the only remaining centred block is the footer's venue address, a signature block, which the rule does not cover |
| 8 | **`/the-wedding` wasted the Gilded Hour first screen** | blocker | Fixed `dc6045b`: heading at 648, answer at 664, fold at 772; "What to wear" lifted above the numbered spine |
| 9 | A fixed floating control still passes over scrolling text mid-page, identically in both designs (18 and 15 hits on the longest page) | should | **Integrator decision: accepted.** The reservation fix means nothing is occluded at rest, top or bottom; a small floating control overlapping text while scrolling is standard mobile behaviour. The alternative offered — padding the prose column's inline end below 900px — costs about a quarter of a 390px screen on every page. Recorded for level 16 |
| 10 | Two switcher instances give two controls the same accessible name ("Choose a design") | nit | Level-04 chrome, found by the integrator probe; carried to level 16 |
| 11 | `font-style: italic` on the placeholder hint was dead CSS, and Conservatory's DESIGN.md claimed Spectral ships a true italic | nit | Fixed: rule removed, DESIGN.md corrected (neither design ships an italic text face; `font-synthesis: none` is inherited) |
| 12 | Chrome tab stops before content; sub-44px links; 13.81px form labels in Gilded Hour | nit | Fixed: panel emitted after `</main>` (7 → 3 stops, both designs), 0 links under 44px, labels 13.81 → 18.06px |

## 2. Authorization table

Level 05 adds public content routes and admin content editors. Every read goes through a capability; the guide and docent surfaces are anonymous by design.

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test performed | Result |
|---|---|---|---|---|
| `/our-story`, `/our-adventures`, `/our-adventures/[slug]` | `get_story`, `list_adventures`, `show_adventure` / read | anonymous; `filterVisible` drops drafts and out-of-scope records | draft record requested directly → not found | pass |
| `/share-an-adventure`, `/share-an-adventure/[slug]` | `find_adventures`, `list_itineraries` / read | anonymous; curated records only | unpublished recommendation → not found | pass |
| `/explore-caa`, `/explore-caa/[space]` | `get_venue_facts`, `show_venue_room` / read | anonymous; operational facts carry provenance and freshness | n/a (public) | pass |
| `/the-wedding`, `/ask-us` | `site_status`, `get_faq` / read | anonymous | n/a (public) | pass |
| `/admin/content/*` | `admin_content_*` / read + action | admin + `admin_content`; idempotency keys on mutations | guest and anonymous refused | pass |

Step-up required for any money/identity action? **n/a** — none at this level.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_[A-Za-z0-9]{8,}|BEGIN (RSA|EC) PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs
(nothing)
```

- [x] No guest names, emails, addresses, phone numbers, or table assignments. The only people named are the couple, their vendors, and Wikimedia photographers, all public
- [x] No provider keys; content is seeded from `docs/design/brief.md` §2 only
- [x] EXIF/GPS: no photography ships at this level (backlog C-07)

## 4. Tests

| Area | Covered by (file) | Not covered — why / follow-up |
|---|---|---|
| Unit + UI | content schemas, seed, visibility, placeholders | |
| Integration (PGlite) | content capabilities, provenance and freshness, admin editors | |
| E2E (202 passed, mobile/tablet/desktop) | `tests/e2e/content-themes.spec.ts` (structural signature per page × design, and the other design's markers absent), `explore.spec.ts`, plus new regressions for ticket identifiers, bottom-chrome reservation, heading outline and jump targets, and first-screen content | |
| Axe | 9 pages × 2 designs × 3 viewports, 0 serious or critical | |
| Anti-slop | source detector in `verify`; live detector exit 0 on 20/20 URLs | |

## 5. Threat-model items touched

- [ ] 0001 identity, 0002 capabilities (unchanged), 0003 AI grounding, 0004 external transactions, 0005 media, 0006 biometrics: not touched
- [x] 0011 provenance: every operational fact carries `sourceId`, `verifiedAt` and a freshness state; the stale CAA outlet list is the worked example
- [x] 0012 lifecycle: content pages honour the lifecycle state and the admin preview from level 04

## 6. Design verdict per page and design

Independent `design-reviewer` round, then a fix round, then integrator verification of every blocker. The reviewer's pre-fix scores are the record in each critique file; the six blockers it raised are all closed and independently re-measured. Its verdict before the fixes was that no page reached the ship threshold; after them, every blocker it named is gone and the level's own regression tests hold the line.

| Page | Gilded Hour (pre-fix) | Conservatory (pre-fix) |
|---|---|---|
| `/our-story` | 6/7/6/4 | 8/6/8/4 |
| `/our-adventures` | 7/7/6/3 | 7/6/7/3 |
| adventure detail | 6/6/6/3 | 7/6/7/3 |
| `/share-an-adventure` | 6/4/6/6 | 7/4/8/6 |
| recommendation | 7/6/6/6 | 7/6/7/6 |
| `/explore-caa` | 6/5/8/7 | 8/5/8/7 |
| space detail | 7/6/7/7 | 8/6/8/7 |
| `/the-wedding` | 5/5/6/3 | 8/5/7/3 |
| `/ask-us` | 6/6/6/7 | 8/7/7/7 |

Content scores are gated by the couple's backlog and are not an engineering blocker.

## 7. Accessibility and performance

- Axe: 0 violations across 54 scans (9 pages × 2 designs × 3 viewports), not regressed by the fix round.
- Keyboard: 3 chrome tab stops before content in both designs (was 7 in Gilded Hour); every input has a visible label at 18.06px; every focus stop shows a ring; standalone links meet the 44px target size in both designs.
- Reduced motion: genuinely clean in both designs.
- No horizontal scroll at 390px on any of the 18 combinations.
- LCP 88–196ms, CLS 0 (reviewer's harness).
- Print: not yet exercised for logistics pages; level 16.

## 8. Docs and ADRs

- 18 page critiques under `docs/design/critiques/`, each carrying the independent scores as the scores of record and what changed.
- `docs/design/CHANGELOG.md`: level-05 entry.
- Conservatory `DESIGN.md`: the false claim that Spectral ships a true italic is corrected.
- No new ADR; ADR-0011 (provenance) and ADR-0012 (lifecycle) are implemented as written.

## 9. TODO inventory

```
$ grep -rn "TODO(Tyler & Sara)" src | wc -l
76
```

All render as visible, attributed placeholders reading "Sara + Tyler are still writing this", never as prose. They cluster on Our Story (3 of 5 chapters), Our Adventures (one public entry), and The Wedding (7). Owner: Tyler & Sara, tracked as backlog C-01, C-02, C-07, P-01, P-02.

## 10. Verdict

**READY.** A reviewer could reject this for the Content axis, and they would be describing the couple's backlog rather than the code. The engineering case is that an independent review found six blockers, all six are fixed and independently re-measured by the integrator rather than taken on trust, the level ships 202 passing end-to-end and accessibility checks with a clean anti-slop detector on all 20 URLs, and both designs remain structurally distinct with each page asserting the other design's markers are absent.
