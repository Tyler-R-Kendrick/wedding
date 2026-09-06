# PR 09 — Travel & Stay, the trip bridge, and two designs for a page that had none

Level **08** of 17. Base: `main` (level 07 merged as `8fe223b`).

## 1. Hostile-reviewer pass

*What is the worst thing a reviewer could say about this diff?*

**"You shipped a public page that printed an internal backlog id, and the home page has been showing
`TODO(Tyler & Sara):` to visitors for four levels."** Both true, both fixed here, and the second one
is the more embarrassing: the theme kit's own placeholder used the authoring marker as its label, so
the front page of the site has carried it since level 04. It survived because
`tests/ui/home.test.tsx` asserted the marker was **present** — as its proxy for "this is marked as a
placeholder". The test was pinning the bug in place. That is the third time in this run a test has
turned out to assert the defect rather than the guarantee (level 07 found two others), and it is now
the specific thing I check when a level's tests all pass on the first run.

**"Most of this PR is not the feature."** Correct. Swarm F built travel from the level-03 base,
before the theme engine (04), the placeholder convention (05) and the identity tables (06) existed.
The feature arrived working; what it cost was four integrations that only a merge could surface.

**"`/trip` still does not go through the theme engine."** True, and stated in the PR body rather
than implied. See §6.

## 2. Authorization table

| Capability | Kind | Auth + entitlement | IDOR test | Result |
|---|---|---|---|---|
| `list_hotel_recommendations` | read | anonymous | n/a — public curated content, no guest data in the output | pass |
| `search_travel_options` | read | anonymous | n/a — no stored data read; metered per client IP at the route | pass |
| `open_booking_link` | external | anonymous, **but** `hosted_flights` requires a guest inside the handler | `tests/integration/travel.test.ts` — anonymous refused `unauthenticated`, another household refused `not_found` | pass |
| `get_my_travel_profile` / `update_my_travel_profile` / `delete_my_travel_profile` | read/action | guest · `view_travel_tools` | cross-household read and write refused; manager may act for a member | pass |
| `get_my_trip` / `add_trip_item` / `update_trip_item` / `remove_trip_item` | read/action | guest · `view_travel_tools` | swapped ids, another household, and anonymous all refused | pass |
| 5 × `admin_*` travel | read/action | admin · `admin_content` | entitlement-gated; none exposed to an assistant | pass |

Three capabilities join the **anonymous** list — the first additions since level 05, and the line
level 07 deliberately held. Each is argued in the assertion's own comment. The one that needed real
scrutiny is `open_booking_link`: `auth: 'anonymous'` means the pipeline does **not** reject first, so
the guest-only variant is guarded inside the handler by `requireGuestWriter`. **I proved that guard
is what the test exercises** by neutering it — the test fails. That is the level-07 lesson applied
before, not after, the fact.

## 3. Secrets and PII grep

`guest_travel_profiles` is the sensitive table here: home city, preferred airport, travel dates —
opt-in, never inferred from IP, and deletable by the guest. It now carries a real foreign key to
`guests` with `onDelete: 'cascade'`, so "delete the guest" cannot leave it orphaned. No provider
credential is read on a public path; the flights and hotels adapters fall back to deep links when
unconfigured, which the e2e asserts in both modes. `.env` untouched. No new secret material.

## 4. Tests — and one that asserted the bug

Unit and UI **284**, integration **122**. The contract suites (`tests/contract/**`) were **confirmed
to execute by name**, not assumed: they run inside the `unit` project, and level 07's lesson is that
a suite nobody has watched run is not evidence.

Added or corrected:

- **Redirect allowlist bypasses.** F added the file's only regex host matcher. Probed it before
  accepting it, and the four shapes a regex allowlist usually leaks on
  (`skyscanner.com.evil.com`, `attacker-skyscanner.com`, `notskyscanner.com`,
  `skyscanner.com.attacker-skyscanner.com`) are now cases rather than something I checked once.
- **Marker and backlog-id leakage** on `/`, `/travel` and `/trip`, in both designs, in
  `tests/e2e/themes.spec.ts` and over the whole serialised capability payload in
  `tests/integration/travel.test.ts`.
- **`tests/ui/home.test.tsx`** now asserts the marked element and the label a guest reads, and the
  **absence** of the raw marker. It previously asserted its presence.
- **`tests/integration/travel.test.ts`** principals now name seeded fixture guests. The new foreign
  keys caught that it had been writing rows for guests that did not exist.

**Deliberately not covered:** live provider credentials (mock and deep-link modes only, as the
activation doc records); `/trip` at the tablet viewport.

## 5. Threat-model items touched

Open redirect (the allowlist, including its first regex entry), external hand-off audit, and the
per-IP metering of anonymous capability traffic. The webhook path answers uniformly to unsigned
payloads, asserted in the e2e.

## 6. Design verdict per theme

An independent review ran on `/travel` and `/trip` in both designs at 390/768/1440 and returned
**FIX FIRST** — Gilded Hour 4/4/5/5, Conservatory 7/6/7/5, against a gate of ≥7 everywhere and
Usability ≥8. Full report: `docs/design/critiques/2026-09-06-travel-trip-round1.md`. Four blockers,
each re-measured with my own probes before I touched anything:

| Blocker | Measured | Fixed by |
|---|---|---|
| GH room-block card clipped at 390 | children 609px wide running to x=670 in a 390px viewport; `overflow-x: clip` hid it, so the title just read "CHICAGO ATHLETIC A" | `grid-template-columns: minmax(0, 1fr)` — a grid item's default `min-width: auto` is its content's minimum |
| Conservatory contrast | axe: `#677764` on `#f4eedf` = 4.12:1, from `text-primary/70` (a raw opacity on a token) | `.hint` / `.eyebrow` on `--color-on-surface-muted` |
| A seeded guest could not reach `/trip` | `GUEST_DEFAULT_ENTITLEMENTS` lacked `view_travel_tools`, which `get_my_trip` requires | entitlement added; new `tests/e2e/trip.spec.ts` |
| Body copy at 14.875px | 8 elements under the 17px floor in GH, 3 in Conservatory | `text-sm` removed across 33 sites |

**Two of my specs were not covering what their names said.** `travel.spec.ts` called
`page.goto('/travel')` with no `?theme=`, so every assertion in it — axe included — only ever
visited the default design; Conservatory's contrast failure had never been machine-checked. And the
`/trip` case asserted the signed-out prompt while a test principal could not get past that prompt
either, so it was asserting the same page in both roles and reporting it as coverage. Both are now
parameterised by design, and the travel spec additionally asserts no viewport overflow and the 17px
floor — the two properties that would have caught this level's other defects.

**Accepted, not fixed, and stated rather than implied:** `/trip` still does not go through the theme
engine (the reviewer recommends not blocking on it; the seam is cut and it is level 09's first
task), Gilded Hour's line length runs to ~146ch at 1440, and the design system's uppercase
micro-labels are 13.8px — a DESIGN.md type-scale question that belongs in a design round, not in a
travel PR, so the e2e floor assertion excludes them and says why.

**The criticism I think is most worth keeping:** "one IA, two skins". The kits genuinely
differentiate, but the two recipes differ by three substantive lines, every word is identical, and
neither builds the concept its own doc comment claimed. The comments overclaimed; they now describe
what the code does, and making the pages structurally distinct is next round's work rather than
something asserted in a comment.

After the fixes: `/travel` in both designs at three viewports has **0 axe serious/critical, 0
elements overflowing, 0 running copy under 17px**; `/trip` signed in, both designs, axe clean.

## 7. Accessibility and performance

`axe` runs on `/travel` in both designs at three viewports as part of the production arrangement:
190 passed, 0 failed. Two accessibility defects were found and fixed **by the gate rather than by
me**: the kit's `Stat` emits `<dt>`/`<dd>` and I had not wrapped them in a `<dl>` (axe `dlitem`,
180 nodes), and `Stat` silently discards its `value` when `placeholder` is set, so "the date to book
by" had become "book by" without any test noticing.

The layout defect this level is really about was also an accessibility one: with `max-w-3xl`
resolving to 96px, every element on the page was clipped to zero width. Playwright reported the
airport codes as "hidden", which is how it surfaced.

## 8. Docs and ADRs

`docs/design/critiques/2026-09-06-travel-trip-round1.md` is this level's design report.
`docs/architecture/` gains F's travel notes. The content backlog gains nothing new here; level 07's
X-07 and X-08 stand.

## 9. TODO inventory

99 `TODO(Tyler & Sara)` markers in `src/`, all in content records, seed JSON and admin surfaces —
**none of them now render to a guest**, which is the change this level makes. The travel facts split
into `note` (confirmed) and `pending` (still to be decided, in the guest's words), so the marker is
no longer the mechanism by which a gap reaches the page. No invented wedding facts.

## 10. Verdict

**READY.** `npm run verify` green in its log; production arrangement **193 passed**, test-server
arrangement **71 passed**, both on freshly started servers. The design review's four blockers are
fixed and each fix is measured; what is not fixed is listed in §6 with a reason and an owner rather
than left to be discovered.

One process note worth carrying forward: three times in this level a measurement came back wrong
because a pre-rebuild server still held the port, and once I nearly acted on a "fully unthemed"
reading that was a stylesheet-timing artefact. Checking that the server is the one I just built,
before believing what it renders, is now part of the loop rather than something I remember after
being burned.
