# PR #38 — Our Story ride: design review and dispositions

Review: `design-reviewer` agent, 2026-09-23 (full report in
`.impeccable/critique/2026-09-23-our-story.md`). Verdict **FIX FIRST** —
Design 7 · Usability 5 · Creativity 8 · Content 4. Content stays low by design until the
couple's Paired timeline is imported (backlog C-11); every station says honestly what is missing.

## Blockers

| # | Finding | Disposition |
|---|---|---|
| B1 | At 375×667, 15 of 16 cards overflowed their window into an unmarked inner scroller | Fixed. The phone action bar steps aside while the stage is pinned (`html[data-ride-pinned] .bd-bar`); the sign is one row with arrow buttons; `height ≤ 720px` and `≤ 820px` layouts; a card that still overflows is masked and shows "More ↓", and only then becomes a focusable scroll region. Measured after: 3 of 16 overflow at 375×667 (the longest chapter signs), each marked. |
| B2 | Map links focusable while off-screen (WCAG 2.4.11); the hidden-overflow strip scrolled and drifted | Fixed. The car card is a real scroller (hidden bar): the ride recentres it on the train, a guest can swipe it, focus scrolls a tabbed station into view natively, and while pointer/touch/focus is inside it the ride leaves it alone. Spec asserts the focused link is inside the card. |
| B3 | Arrow keys did not move between stations | Fixed. Roving tabindex (one tab stop), Arrow/Home/End walk the map, Enter rides. |
| B4 | 15 detector findings | Fixed to 0. `side-tab` ×9: station cards carry the full-width line plate, the sign's stripe became a bullet, the map edges are hairlines. `tight-leading`: map links at 1.4. `content-hidden-at-rest`: no longer fires (scenery `aria-hidden`, "Read it as a list" exists). Waived with rationale in `.impeccable/config.json` and `docs/design/approved-botanical-deco/detector-waivers.md`: `clipped-overflow-container`, `cramped-padding`, `repeating-stripes-gradient` — the stage is a camera window. |
| B5 | Licence link and "Stand-in photo" at 13.8 px via the ornament exemption; link opened a new tab silently | Fixed. Both 17 px `body-sm`; the credit is a caption line under the photo; no new tab. |

## Should-fix

| # | Finding | Disposition |
|---|---|---|
| 1 | Flings stop mid-travel | Fixed. `scroll-snap-type: y proximity` with one snap target mid-plateau per station; `DWELL` 0.5 → 0.6. |
| 2 | Departing card ghosted over the arriving one | Fixed. Passed cards slide out sideways while opaque (signs rise out of view); fade only once off-centre. |
| 3 | Next transfer hidden behind the current card | Fixed. Transfers hang above the track (`--hang`). |
| 4 | Long frames | Addressed. Geometry is measured on resize/reflow only (ResizeObserver), never in the scroll frame; `--p` is written on the stage; `will-change` only on the five nearest stops; floor sleepers and skyline move by `transform` with `mod()` instead of animating `background-position`; `dataset` written only on a new station. Not re-measured on a real phone. |
| 5 | No in-page escape from motion | Fixed. "Read it as a list" toggle (`aria-pressed`, remembered in localStorage, safe when storage is blocked). |
| 6 | Phone map was unlabelled dots | Fixed. The current station is named under its dot. |
| 7 | Intro promised a map the flat modes hid | Fixed. Flat modes show the stations list (sticky beside the stops on desktop). |
| 8 | Back/Next read as a cut; long jumps flickered | Fixed. Script-driven scroll, 650 ms + 260 ms per stop, capped at 2.4 s; a wheel or touch takes over. |
| 9 | Arrival announced from the hero | Fixed. Announced only while the stage is pinned. |
| 10 | `inert` hid 15 stops from find-in-page | Fixed. Scenery is `aria-hidden` with its links out of the tab order; the words stay findable. |
| 11 | Terminal address not tap-to-map | Fixed. Links to the venue's maps URL, named "directions in {provider}". |
| 12 | Two quick Next presses advanced one stop | Fixed. Presses queue from the in-flight target. |
| 13 | Card was a tab stop even when it did not scroll | Fixed. Focusable only while it overflows. |

## Found while verifying

- **Stations linked to unpublished adventures (404).** The production link walk (`links.spec.ts`
  against `next start`) caught "Read the memory" pointing at Our Adventures drafts that guests
  cannot open. Stations now link only to adventures visible to the reader; the integration test
  asserts a draft is named but not linked.
- **Preview 500.** Previews read the production database and never migrate, so `timeline_moments`
  did not exist there; the repo now serves the bundled seed stations until it does
  (`tests/integration/timeline-unmigrated.test.ts`).

## Self-review (code), 2026-09-23

| # | Finding | Disposition |
|---|---|---|
| 1 | Re-seeding inserted timeline stops and never updated or pruned them, so a reordered or renamed seed left stale stations | Fixed. Upsert by slug and prune seed/import rows the seed no longer lists; admin-edited rows (`contentVersion > 1`) and hand-typed rows are left alone (`tests/integration/timeline-seed.test.ts`). |
| 2 | The knowledge projection read `timeline_moments` without the missing-table fallback, so the concierge would fail on a preview | Fixed. Shared `isMissingTable()` (`src/db/missing-table.ts`); both readers fall back. |
| 3 | A station slug could equal a story chapter's id or `the-loop`, giving two elements one anchor | Fixed. The seed validator refuses it, `timelineAnchors()` suffixes any collision, and the importer never mints one. |
| 4 | Gilded Hour, Conservatory and the fallback recipe dropped the timeline entirely | Fixed. Each renders the stations as an "Along the way" list (`src/themes/shared/timeline.tsx`). |
| 5 | A key, wheel or touch did not interrupt a scripted glide | Fixed. Anything outside the ride's own controls cancels it. |
| 6 | `get_story` read story and timeline one after the other | Fixed. In parallel. |
| 7–10 | Paired import: midnight-UTC dates slipped a day; one-character titles, 200-character places and duplicate refs produced rows the seed rejects; a new stop could take an existing stop's slug | Fixed, each with a unit test. |

Merged main twice (#36, #37): #36's migration 0011 kept, the timeline table regenerated as 0012;
#37's theme words kept on the Story hero, and this PR's parity exception renumbered PX-25 → PX-29
because #37 took PX-25.
