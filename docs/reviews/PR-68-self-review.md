# Self-review of PR 68 (stack 3/3): Browse-as-a-guest follow-ups

| Field | Value |
|---|---|
| Branch | `claude/inspiring-ride-d1z46t-03-followups` |
| Base | `claude/inspiring-ride-d1z46t` (#66) |
| Reviewer | the adversarial self-review agent (not the builder), reading `origin/claude/inspiring-ride-d1z46t...origin/claude/inspiring-ride-d1z46t-03-followups` |
| Date | 2026-09-27 |
| Commands run | `npm run quality`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, a moderator probe of `/admin/guests` on a NODE_ENV=test server |

## 1. Hostile-reviewer pass

No blocker was found. There was one nit here, plus one nit carried up from #66 because the code it concerns lives in this PR.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `ownGuestRecords` had been inserted between `buildGuestViewPrincipal` and its doc comment, so one function had two stacked comments and the other had none. | nit | Fixed in `41894cc`. |
| 2 | (#66 nit 11) The Guests screen named the viewed guest from the filtered rows, so it could say "Stop browsing as a guest". It also verified the token in a page. | nit | Fixed in `1d8738e`. `admin_guest_view_status` (read, ui only) verifies this browser's token against the admin's own session and names the guest. It returns null for a missing, tampered or other-session token, and each case is tested. |

Checked and correct:
- `ownGuestRecords` excludes delegate bindings, admin-made bindings, merged guests, children and minors. `buildGuestViewPrincipal`'s own-record branch uses the same set.
- An admin without `admin_guest_ops` gets the browse section only, backed by `admin_list_own_guest_records` (`auth: 'admin'`, no requirements). Owners always hold guest ops, so they never land in that branch.
- The per-row "Browse as" button is not offered for a child.
- `previewAs` is gone from `src`, `tests` and `docs`.
- The admin capability count is 72, pinned in `resolver.test.ts` with the reason for each addition.

## 2. Authorization table

| Route / action | Capability + kind | Server-side check | Tested | Result |
|---|---|---|---|---|
| `/admin/guests` (any admin) | `admin_list_own_guest_records` (read, admin) | `adminOf`; returns only records bound to this identity by the guest's own claim | own record listed; planner with an admin-made binding gets `[]` | OK |
| `/admin/guests` "Stop browsing as ‹name›" | `admin_guest_view_status` (read, admin) | token verified against this admin's session id | valid → named; tampered or other session → null | OK |

Step-up: n/a (reads).

## 3. Secrets and PII grep

Nothing new. The test fixtures are the existing `example.test` addresses.

## 4. Tests

| Area | Covered by |
|---|---|
| UI | `tests/ui/guest-view-band.test.tsx`: whose view, read-only vs own record, the stop button's name, no repeated name, nothing for a guest, an admin or no session |
| Integration | `tests/integration/identity/guest-view.test.ts`: own-record listing, status capability, admin-made bindings; `resolver.test.ts`: count |

## 5. Threat-model items touched

- [x] 0001 identity: "your own record" is defined once (`ownGuestRecords`) and used by both the view and the list.

## 6. Design verdict

- The moderator's Guests screen shows one section with its reason instead of a refused list, and there is no dead end from "Browse as a guest".
- The design changelog records the band.

## 7. Accessibility

The new buttons use the console's `Button` (labelled, 44px). No new colours or sizes; `npm run quality` reports 0 findings.

## 8. Docs and ADRs

- `docs/design/CHANGELOG.md`: the band's bullet.
- The three stack self-reviews: `docs/reviews/PR-67-self-review.md`, `PR-66-self-review.md` and this file.

## 9. TODO inventory

None added.

## 10. Verdict

**READY.** This PR closes the stack's remaining follow-ups. No follow-up work is left for later, and the one pre-existing item noted during the work is recorded below.

**Pre-existing, outside this stack:** React warns in development ("Encountered a script tag while rendering React component") on a client-side navigation into one of the four layouts that set `data-theme` with an inline `<script>`: `t/[theme]`, `(public)`, `(auth)` and `not-found`. It predates this work and is harmless: the script's job is done on the first paint, and `ThemeSync` covers client navigations. There is no fix within this version's App Router. `next/script`'s `beforeInteractive` is limited to the root layout, and the root layout cannot know the design without making every page dynamic.
