# Self-review of PR 66 (stack 2/3): admins can browse the site as a guest

| Field | Value |
|---|---|
| Branch | `claude/inspiring-ride-d1z46t` |
| Base | `claude/inspiring-ride-d1z46t-01-masthead` (#67) |
| Reviewer | three independent agents, not the builder: an adversarial security review (commit `0967d37`), the `design-reviewer` agent, and the adversarial self-review of the committed stack |
| Date | 2026-09-27 |
| Commands run | `npm run quality`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, Playwright `tests/security/guest-view.spec.ts` (real OTP sign-in) + `quality-sweep` + `admin-console` on a NODE_ENV=test server |

## 1. Hostile-reviewer pass

The security review found 1 blocker, 5 "should" and 5 nits. The design review found 1 blocker, 2 "should" and 4 nits that belong to this PR. The stack self-review found 3 nits.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | A read-only view showed a claimed ride's bearer code or Uber link, which is redeemable by anyone who copies it. The console never shows it. | blocker | Fixed in `ad8de2e`. `benefitViewsFor` returns `hidden` for a read-only viewer, tested in `transport-claims.test.ts`. |
| 2 | Reads during a view were audited as the guest, and refused writes looked like the guest's attempts. There was no end event. | should | Fixed in `ad8de2e`. `PrincipalRef` carries `viewedBy`, so every row names the admin, and `guest_view.ended` is recorded. |
| 3 | The concierge (`kind: read`) kept a session and the admin's questions as the guest's, and drained the guest's rate limits. | should | Fixed in `ad8de2e`. It is refused in a read-only view (both doors), and `principalKey` charges the admin. |
| 4 | `admin_guest_ops` let a planner read uploads in every state and travel profiles that no planner screen shows. | should | Fixed in `ad8de2e`. Viewing anyone else is owner-only, and never a child or minor. |
| 5 | An admin could make any guest "their own record" (writable) by rebinding it to their inbox. | should | Fixed in `ad8de2e`. Bindings with `claimMethod: 'admin'` never count. |
| 6 | Step-up broke during a view: `/step-up` resolved as the read-only guest. | should | Fixed in `ad8de2e`. `/step-up` is an admin surface. |
| 7 | A client could set `x-pathname` on `/api` routes; `/api/webmcp/invoke/admin_*` was missing from the admin surfaces; children could be viewed; `/transportation` and `/trip` were not in the no-store list. | nits | Fixed in `ad8de2e`. The real URL wins on `/api`, the route list is extended, children are refused, and both paths are added to `PERSONALIZED_ROUTE_PREFIXES`. |
| 8 | The band's focus ring was drawn in the band's own colour in Botanical–Deco (WCAG 2.4.7). | blocker (design) | Fixed in `ad8de2e`. The rule is scoped past each design's `:focus-visible`. |
| 9 | Two names for one action ("Back to the console" / "Stop browsing"); the admin's two buttons touched on guest-only pages; `role=status` wrapped a form; the household name repeated the guest's; the two bands merged at 390px. | should / nits (design) | Fixed in `ad8de2e`. The action is "Stop browsing as ‹name›", there is a `.page__actions` row, the role is on the sentence, the household shows only when it adds something, and a hairline separates the bands. |
| 10 | The resolver's comment said the proxy "always" overwrites `x-pathname`; its matcher skips `/t/`. | nit | Fixed in `db3c362`. It only ever chooses between the admin's own two principals. |
| 11 | The Guests screen named the viewed guest from the filtered rows, so it could read "Stop browsing as a guest". | nit | Fixed in #68 (`1d8738e`), where that code now lives: the new `admin_guest_view_status` capability names the guest. |
| 12 | On this PR alone, a moderator following "Browse as a guest" lands on a screen they cannot use. | nit | Fixed in #68 (`7966547`). Every admin gets a browse section and their own records. |
| 13 | `draft` kinds are refused in a read-only view, so the RSVP review step cannot be reached. | nit (by design) | Kept. A draft stores state in the guest's name, and the view reads without writing. |

Also checked, and found correct:
- **Token:** it is bound to the session by HMAC with domain separation from the preview and confirmation tokens, and it has an expiry. It is refused for another session, for a guest, or after sign-out, and sign-out also deletes it.
- **Read-only enforcement:** `authorize` is the single choke point for invoke, the registry lists and WebMCP.
- **No write outside `invoke`:** there is no route handler or guest server action that writes without going through `invoke`. All 64 read/navigate descriptors were scanned; the only one that writes is the concierge, and it is closed.
- **`/api/session`:** it names a guest only to the admin browsing as them, and responses are `no-store`.

## 2. Authorization table

| Route / action | Capability + kind | Server-side check | Tested | Result |
|---|---|---|---|---|
| `/admin/guests` "Browse as" | `admin_browse_as_guest` (navigate, admin) | `adminOf` plus `buildGuestViewPrincipal`: owner for others, own record for anyone, never a child | moderator, planner and child refused; admin-made binding refused; tampered, other-session and guest-held tokens ignored | OK |
| every non-console request while viewing | resolver → `GuestPrincipal.viewedBy` | `authorize`: read/navigate only when read-only | writes refused (integration + e2e via `/api/capabilities`) | OK |
| `/admin/**`, `/api/capabilities/admin_*`, `/api/webmcp/invoke/admin_*`, `/step-up` | resolver `isAdminSurface` | stays the admin principal | integration | OK |
| band "Stop browsing" | `stopGuestView` (server action) | deletes this browser's cookie; audits only a valid view | e2e | OK |
| `/transportation` while viewing | `get_my_transportation_options` (read) | `benefitViewsFor` hides the redemption for a read-only viewer | `transport-claims.test.ts` | OK |

Step-up: starting a view does not require one. It reads what the owner can already see in the console, and the view writes nothing. Step-up for console actions still works during a view (`/step-up` is an admin surface).

## 3. Secrets and PII grep

The template grep matches only `ask_concierge` (`sk_`). There are no keys, guest names or emails. The fixtures are the existing `example.test` addresses.

## 4. Tests

| Area | Covered by |
|---|---|
| Unit | `tests/unit/identity/guest-view.test.ts` (token, admin surfaces, cookie parsing); `tests/unit/policy.test.ts` (read-only authorize); `tests/ui/account-menu.test.tsx` |
| Integration | `tests/integration/identity/guest-view.test.ts` (owner view, reads vs writes, concierge, admin surfaces, forged `x-pathname`, audit `viewedBy`, session binding, roles, children, admin-made bindings, own record); `transport-claims.test.ts` (ride credential hidden); `resolver.test.ts` (capability count) |
| E2E | `tests/security/guest-view.spec.ts`: real admin OTP sign-in, the console button, the cookie, the band, a refused write, the console as admin, stop |

## 5. Threat-model items touched

- [x] 0001 identity: a new, explicit exception to "admins are never guests", documented in `docs/architecture/identity.md`. The view is bound to the session, read-only for anyone else, owner-only, and audited.
- [x] 0002 capabilities: read-only enforced in `authorize` so derived lists agree; `principalKey` keys on the admin.
- [x] 0003 AI grounding: the concierge is closed in a read-only view.
- [x] 0004 external transactions: the ride bearer credential is never shown to a viewer.
- [x] 0012 lifecycle: the admin preview carries into a view.

## 6. Design verdict

The band uses the preview band's tokens in all three designs, is 18px with 44px targets, and has a visible focus ring. The design review's blockers are fixed.

## 7. Accessibility

- 0 serious/critical axe issues on the pages walked.
- The band's status sentence is announced, and its button is labelled with the guest's name.

## 8. Docs and ADRs

`docs/architecture/identity.md` resolver section updated. The changelog bullet for the band lands in #68.

## 9. TODO inventory

None added.

## 10. Verdict

**READY.** A reviewer would reject a feature that lets an admin act as a guest. This one lets an owner *see* as a guest and nothing more: every write, the concierge and the ride credential are refused centrally and tested. Each start and end is audited with the admin named on every row, and the token is worthless outside the session that minted it.
