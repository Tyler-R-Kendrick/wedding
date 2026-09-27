# Self-review of PR 67 (stack 1/3): mastheads fit their real labels

| Field | Value |
|---|---|
| Branch | `claude/inspiring-ride-d1z46t-01-masthead` |
| Base | `main` |
| Reviewer | two independent agents, not the builder: the `design-reviewer` agent (on the working tree before the stack was split) and an adversarial self-review agent reading the committed stack diff `origin/main...claude/inspiring-ride-d1z46t-01-masthead` |
| Date | 2026-09-27 |
| Commands run | `npm run quality`, `npm run slop:detect:rendered` (51 pages × 4 viewports), `npm run typecheck`, `npm run lint`, `npm run test:unit`, Playwright `quality-sweep.spec.ts -g masthead` on a NODE_ENV=test server, `tsc` on a `git archive` of the branch alone |

## 1. Hostile-reviewer pass

One blocker, two "should" and three nits. All are resolved in this PR.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | From 1600px, the motto showed beside a row that did not fit, clipping "Your account" (more than half of it at 1920 for a signed-in guest). During `measure-extra` the page-count rules sometimes already hid the Menu button, and NavFit then added the Menu's room a second time. | blocker | Fixed in `347fb3d`. The kit hides the Menu button during `measure-extra`, and NavFit compares the row with the room it has beside the motto only once. |
| 2 | The masthead guard stopped at 1440px, below every width where the motto can appear, so it passed with finding 1 live. | should | Fixed in `347fb3d`. The guard adds 1600 and 1920 and a signed-in guest pass. It fails on the previous code ("YOUR ACCOUNT" overlaps the motto and runs past the list). |
| 3 | The CI test server never compiled the lifecycle preview route the sweep walks, which is the cold-compile starvation pattern its own comments describe. | should | Fixed in `347fb3d`. `/?preview=RSVP_OPEN` is in the CI warm-up and in `WARM_ROUTES`, and `test-server-specs.test.ts` keeps the two lists in step. |
| 4 | NavFit counted the list's padding as usable room, so the last visible page ran into the clip and lost its focus ring (design review). | blocker (design) | Fixed before the split. `inner()` subtracts the padding, and the guard checks every item stays inside its list's content box. |
| 5 | At 1600px the motto was shown by page count and pushed "Your account" into the sheet (design review). | should (design) | Fixed. The motto is `data-fit-extra` and is kept only when every page fits beside it. |
| 6 | `justify-content: safe center` has no fallback for a browser without `safe`. | nit | Fixed in `347fb3d`: `center` is declared first. |
| 7 | The spec-coverage note said every route in quality-sweep is a guest route. | nit | Fixed in `347fb3d`. |
| 8 | An `overflow: clip` on both axes swallowed the account popover. This was caught by the builder's own guard while building, not by a reviewer. | nit (self-caught) | Fixed. Only the inline axis is clipped, and the guard hit-tests the popover's links. |

Checked and found correct:
- The branch builds and typechecks on its own. Nothing references guest-view, which lands in #66.
- The CSS specificity holds: `[data-fit]` rules (0,3,1) and (0,4,1) beat the page-count `nth-child` rules (0,2,1); the Menu rules tie and win by source order; the motto rules (0,4,0) beat `:not(--gt6)` (0,3,0).
- Without script there is no `data-fit`, so the count rules apply and the clip keeps the row off the monogram.
- The MutationObserver ignores attribute changes, so NavFit's own writes cannot loop.
- Gilded Hour keeps the plaque in column 2 and Menu in column 3.

## 2. Authorization table

No route, action or capability is added or changed. The guard reaches lifecycle states through the existing admin preview (`navigate_to` / signed token), and only on the NODE_ENV=test server. Step-up: n/a.

## 3. Secrets and PII grep

The template's grep over the changed files matches only the `sk_` inside `ask_concierge`. There are no keys, guest names, emails or phone numbers.

## 4. Tests

| Area | Covered by | Not covered |
|---|---|---|
| Unit | `tests/unit/agent/test-server-specs.test.ts` (warm list mirrors CI) | NavFit itself: jsdom has no layout, so it is covered in the browser |
| E2E | `tests/e2e/quality-sweep.spec.ts` › the masthead never collides: 3 designs × 9 states × 7 widths (admin preview), plus a signed-in guest at 7 widths | — |
| Axe | quality-sweep's existing axe walk; the design review's axe pass: 0 serious/critical | — |

## 5. Threat-model items touched

- [x] 0012 lifecycle: the guard uses the admin preview. Its route is now warmed in CI; no behaviour change.

## 6. Design verdict per design

| Design | Verdict |
|---|---|
| Botanical–Deco (approved) | The "HOME"/monogram overlap is gone in every state and width. The motto returns at 1600px for a signed-out reader, as the approved design shows, and steps aside when pages need the room. |
| Gilded Hour | No ragged wings. The collapsed header has the plaque centred and Menu at the right edge, per its DESIGN.md. |
| Conservatory | Unchanged; the guard passes. |

## 7. Accessibility and performance

- Axe: 0 serious/critical.
- Focus rings stay inside the clip (padding, plus the guard's content-box check).
- The popover links can be reached (the guard hit-tests them).
- 17px floor unchanged.
- NavFit measures synchronously before paint (a layout effect), so there is no visible jump. It re-measures on a single animation frame.

## 8. Docs and ADRs

`docs/design/CHANGELOG.md`: the 2026-09-27 entry. No ADR changes.

## 9. TODO inventory

None added.

## 10. Verdict

**READY.** A reviewer would reject this for adding a client measurement to the masthead instead of fixing the breakpoints. Breakpoints cannot know a label's width, and that is how this bug shipped with every gate green. The measurement degrades to the old rules without script, and the new guard fails on each of the four regressions met on the way.
