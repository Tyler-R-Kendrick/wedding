# Self-review of PR 57 (destructive admin actions need a yes; seating preview)

| Field | Value |
|---|---|
| Branch | `claude/dazzling-darwin-6yb4e7-admin-safety` |
| Base | `claude/dazzling-darwin-6yb4e7-nav-gates` (PR 55) |
| Reviewer | an adversarial review agent, not the builder, reading the committed diff `187a0ca..050a061` only |
| Date | 2026-09-27 |
| Commands run | `npx tsc --noEmit`, `eslint`, `npm run lint:css`, `npm run design:drift`, `npm run test:unit`, integration `seating`, `admin-console-fixes`, `guests` |

## 1. Hostile-reviewer pass

One blocker, six "should", three nits; every one resolved in `086e817` and the commit after it.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | The preview's guest `<select id="preview">` shared its id with `<section id="preview">`, so its label pointed at the section: an unnamed control and a duplicate id, both axe failures. | blocker | Fixed: the select is `preview-guest`; `name="preview"` still drives `?preview=`. |
| 2 | The preview's floor plan and the plan in "Floor plans" shared `fp-title-<room>`, so the second SVG announced the first one's "your table is…". | should | Fixed: `FloorPlan` takes `idPrefix`; the preview passes `preview-fp` and omits the guest page's highlight id. |
| 3 | The section note was a `<p>` inside the `<p>` that `Section` wraps notes in. | should | Fixed: a plain string. |
| 4 | The preview showed a table to anyone, but a child or minor never holds `view_table_assignment` (ADR-0001 rule 7; `policy/derive.ts`) and has no page. | should | Fixed: the capability returns `state` (`seated`, `not_seated`, `not_entitled`); for a child or minor the screen says they have no page of their own and where they sit as a tablemate. |
| 5 | Merging duplicates left the merged row's seat in the draft, and publishing carried it. | should | Fixed at the cause: `mergeGuests` moves the seat to the kept guest when they have none and frees it otherwise (integration test for both). The preview also refuses a merged guest. |
| 6 | The moved JSDoc on `readPublishedTable` (the "draft never reaches any surface" invariant) was left above `tableViewFor`. | nit | Fixed. |
| 7 | The new checkboxes were about 13px targets; `wedding-site-standards` §7 asks for 44px. | should | Fixed: `.ops-check` and its label are 44px tall, for every console checkbox. |
| 8 | The guest-denial security spec did not list the new capability, the one that reads the draft for any guest. | should | Fixed: `tests/security/seating.spec.ts` covers it. |
| 9 | Each preview loaded every guest to find one. | nit | Fixed: `getGuest`. |
| 10 | Rotating a link, rebinding access and changing an admin role still took effect on one click. | nit (scope) | Fixed in this PR rather than left: each has a `ConfirmCheck` and a server-side check (unit-tested). |

Checked and found correct: the `readPublishedTable` refactor keeps the guest boundary (the three
guest reads still take only the live publication; `tableViewFor` is fed the draft in one place, the
admin capability); the capability is `auth: 'admin'`, `requires: ['admin_guest_ops']`, exposed to
`ui` only; step-up on revoke still holds (the admin ticks and submits again after `/step-up`, as
they already had to re-submit); `withParam` builds `?edit=<id>&error=…` without double encoding.

## 2. Authorization table

| Surface | Auth | Server check |
|---|---|---|
| delete guest / household / table, reset access, merge, revoke, rotate, rebind, set role | admin + entitlement in the pipeline (step-up where the descriptor says) | `confirm=yes` first, then the pipeline |
| `saveGuest` | unchanged | only the error redirect changed |
| `admin_preview_guest_table` | admin, `admin_guest_ops`, `ui` only | read-only; `idSchema` on the id; guests get 403, anonymous 401 (security spec) |

## 3. Secrets and PII

Nothing added; test data is fixture names only.

## 4. Tests

| Area | Covered by |
|---|---|
| Unit | `tests/unit/admin-confirm.test.ts`: all eight confirm-gated actions refuse without the tick and run with it; rotate refuses; a failed guest edit returns to its form |
| Integration | `seating.test.ts` (preview: seated, minor, unknown, guest caller, nothing reaches guests); `admin-console-fixes.test.ts` (merging moves or frees the seat) |
| Security | `tests/security/seating.spec.ts` |

## 5. Threat-model items touched

- [x] 0001 identity: children and minors are shown as having no page; merged guests are inert, and now unseated too.
- [x] 0002 capabilities: every action still goes through `invoke`; the new read is admin-only and hidden from AI and WebMCP.
- [ ] 0012 lifecycle: not touched.

## Verdict

READY. Merge after PR 55.
