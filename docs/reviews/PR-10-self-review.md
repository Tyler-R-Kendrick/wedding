# PR 10 — Ride benefits, gifts and reservations, in both designs

Level **09** of 17. Base: `main` (level 08 merged as `39119c8`). 92 files, +12,381 / −40.

| Field | Value |
|---|---|
| Branch | `claude/wedding-09-transport-gifts` |
| Base | `main` |
| Reviewer | integrator (self), plus two independent `design-reviewer` rounds |
| Date | 2026-09-07 |
| Commands run | `npm run verify`, both CI Playwright arrangements, `impeccable detect`, `design-reviewer`, a rendered-HTML sweep of every guest route in both designs |

## 1. Hostile-reviewer pass

*What is the worst thing a reviewer could say about this diff?*

**"Your site printed `TODO(Tyler & Sara)` to guests on five different surfaces, and four of your
tests were written to make sure it kept doing so."** Both halves are true. Bringing `/gifts` through
the theme engine put the marker on the page as a hand-off card's `<h3>`; pulling that thread found
the same defect on every path where a value that is *authoring metadata* was being rendered as
*guest copy*:

| Surface | What a guest read | Why the test did not catch it |
|---|---|---|
| Mock registry / cash-fund `label` | `TODO(Tyler & Sara): registry link` as the card heading **and** its button | `tests/unit/providers.test.ts` asserted the label **contained** the marker |
| Admin- or env-configured gift `label` | same two places | no test |
| Ride benefit `amountNote` / `validityNote` / `geofenceNote` | `TODO(Tyler & Sara): amount` in the Amount row | `tests/integration/transport-claims.test.ts` asserted the marker came back intact |
| Reservation venue `name` and `note` | `TODO(Tyler & Sara): a restaurant we love` as the card heading | `tests/ui/handoff.test.tsx` hand-built the view object, bypassing `venueView` |
| Transportation topic paragraphs | the marker inline, mid-sentence | the recipe tested `startsWith`, so the two mid-sentence cases rendered as plain fact |

That is the **fifth and sixth** time in this run a test has turned out to assert the defect rather
than the guarantee (level 07 found two, level 08 found two more). The pattern is always the same
shape: the marker is used as a *proxy* for "this is a placeholder", so the assertion pins the marker
into the rendered output. `placeholder: true` is what carries the meaning, and every card already
prints an editorial sentence naming who is still writing.

**"Then you scrubbed the marker in five places instead of one."** Considered and rejected: the five
are not one decision. Free prose keeps the hint (`ExternalHandoffCard`'s note, a venue heading), the
same treatment `Text` and `Paragraphs` have always given content blocks. The ride benefit's
Amount / Valid / Area are *labelled fields*, where a bare hint would read as a value — there the
honest render is the `To be confirmed` the UI already shows for a note nobody has written. A single
shared scrub would have had to pick one of those and be wrong on the other.

**"`/transportation` is half-done."** The independent review was asked to judge exactly this and
answered "unfinished, and measurably so" — three of its six blockers were the same root cause: the
guest kit read `--text-*`/`--font-weight-*`, which only Gilded Hour's *unscoped* Tailwind `@theme`
block declares, so Conservatory's guest pages wore Gilded Hour's numbers (h1 34px/500 against its
own 38.25px/400; h2 25.5px for 27.625px; lede 22.31px for 21.25px) while the themed `/gifts` next
door got all three right. Fixed by reading the `--type-*` set both themes publish under
`[data-theme]`, with the kits' own clamp so the heading scales.

What remains half-done is the *composition*: `/transportation` renders the shared
`TransportationPageRecipe`, not a per-design recipe. Moving it onto the theme Shell means moving the
whole guest tree, including two merged level-07 pages, so it is on the level-16 list rather than
smuggled in here. That is scope, not denial: the type, the frame, the button shape, the nav and the
switcher are all the active design's now, and the detector is clean on all four surfaces.

**"You invented a registry."** The worst finding of the round, and mine: the built-in gift rows
carried `provider: 'zola'` and `https://www.zola.com/`, so the public page said "via Zola" twice and
offered two live outbound links for a registry `docs/design/brief.md` §2 lists as **NOT settled**.
The authoring marker in the label had been the only thing signalling the card was not real — so the
previous commit, which removed the marker, left the invented brand standing alone. Worse than a page
defect: `list_gift_links` is exposed to the AI concierge and WebMCP, so an assistant would have told
a guest the couple are registered at Zola. `placeholder: true` does not undo naming a company. The
mocks now return nothing and each section renders its own editorial "still to come".

**"193 e2e passing means nothing if you measured the wrong server."** It nearly did. Four separate
readings this level were taken against a `next start` or `next dev` process that a previous run had
left holding the port — including one "192 passed" that was measured against a build predating the
change under test. Two of those looked exactly like product failures (a benefit already claimed, a
confirmation token missing) and would have sent me hunting a race that does not exist. The
harness now kills by port, refuses to continue if anything still answers, deletes `.data/pglite`,
and fails the run outright on `EADDRINUSE`. The production arrangement additionally must **not**
export `BASE_URL`: `playwright.config.ts` reads that as "someone else started the server" and sets
`webServer: undefined`, which is exactly how the stale process got measured.

## 2. Authorization table

No route or capability changed its authorization in this diff. The changes are presentation and
read-boundary scrubbing; the level-09 authorization surface is the one reviewed in PR #10's body and
`docs/reviews/PR-09-self-review.md`'s successor sections, unchanged here.

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test | Result |
|---|---|---|---|---|
| `/gifts` | `list_gift_links` (read, anonymous) | none required — public copy only | n/a (no per-guest data) | unchanged |
| `/transportation` | `get_my_transportation_options` (read, anonymous) | `benefitViewsFor` takes a `GuestPrincipal`; an anonymous principal does not compile | `tests/security/voucher.spec.ts` (B1 owner vs B2 same household vs C1 other household vs owner-without-entitlement) | unchanged, all passing |

Step-up: unchanged (`claim_my_transportation_benefit` remains `confirmation: 'explicit'`, refused on
any surface but `ui`).

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_|pk_live|FAL_KEY=|STITCH_API_KEY=|BEGIN (RSA|EC) PRIVATE|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs
src/capabilities/prepare_reservation.ts:25:  nextStep: z.enum(['confirm', 'open_reservation_link', 'ask_us'])
… (all matches are `ask_us` / `ask_` matching `sk_`, plus prior reviews quoting their own grep)
```

- [x] No guest names, emails, addresses, phone numbers, or table assignments in the repo
- [x] No provider keys in client bundles — the Uber adapter is server-only and untouched here
- [ ] EXIF/GPS — n/a, no media in this diff

## 4. Tests

| Area | Covered by | Not covered — why |
|---|---|---|
| Unit | `tests/unit/providers.test.ts` — the built-in providers offer **no** links (no brand, no destination), and a *configured* link is a real hand-off on an allowlisted host with no marker; `tests/unit/themes/lifecycle.test.ts` — no nav item points at a route `src/app` does not serve | — |
| Integration | `tests/integration/gifts-reservations.test.ts` — an admin label containing the marker comes back scrubbed with `placeholder: true`; `tests/integration/transport-claims.test.ts` — the guest read hands back `null` for a marker-bearing note | — |
| UI | `tests/ui/handoff.test.tsx` — the reservation card through the real `venueView`; every transportation topic renders a labelled placeholder and no marker or backlog id | — |
| E2E | `tests/e2e/transport-gifts.spec.ts` — `/gifts` parameterised by design, showing both states at once (a configured registry hands off; the unconfigured fund is a labelled placeholder with no provider and no link); the claim journey asserts no marker reaches `main`. `tests/e2e/links.spec.ts` — every same-origin link on 13 guest-reachable pages in both designs resolves | The themed `/transportation` composition, because there isn't one yet |
| Axe | `/gifts` in both designs via the e2e spec; `/transportation` via `noBlockingAxe` in the same file | `/transportation` is guest-gated, so it stays out of the public axe route list — auditing it there would audit the sign-in page under its name |

**Negative controls.** Two of the new tests were run against the code they replace and seen to fail
before being trusted: the transportation-topics test (`expected 'Getting here, getting around…' not
to contain 'TODO('`) and the nav-route test (`TEASER: nav offers /photos, which no page serves`).
`tests/e2e/links.spec.ts` needed no contrivance — it found a third dead link, `/photos` from the
"Can I take photos?" FAQ answer, on its first run, after I had fixed the two I knew about by hand.
A test that has never been seen to fail is not evidence.

## 5. Threat-model items touched

- [x] **0004 external transactions (never merchant of record)** — the `/gifts` "no checkout"
      assertion was `page.locator('input, iframe, form').count() === 0` across the whole document.
      That held only because the page had no site chrome; the moment it gained a header and footer,
      the design switcher's own `<form>` broke it. Restated as the guarantee: no form control inside
      `main`, and no `iframe`/`object`/`embed` anywhere on the page. The rule is about the page not
      taking payment, not about the site having navigation.
- [x] **0011 provenance** — `placeholder` remains the field that says "not final". This diff makes
      the marker stop leaking into the rendered value, so `placeholder` is now the *only* signal a
      guest surface acts on — and, after the design round, the only thing a guest-facing gift card
      can *be* until a provider is chosen: there is no built-in row to mark.
- [x] **Three internal links went nowhere**, none of which any existing suite could see.
      `/photos` sat in every lifecycle state's nav (`primary` on WEDDING_DAY, POST_WEDDING and
      ARCHIVE) and in the "Can I take photos?" FAQ answer, which both theme kits render as a link.
      Worse, `/claim` — the destination of **"Find your invitation"**, the primary action on the
      signed-out RSVP and Your Weekend pages, the one an invited guest most needs — has no page at
      all: only `/claim/verify`, `/claim/welcome` and `/claim/passkey`, which you reach with a
      token. That has been live on `main` since level 06. All three fixed against one
      `UNBUILT_ROUTES` list, plus `/sign-in` for the claim button; `tests/e2e/links.spec.ts` now
      walks the whole link graph in both designs.
- [ ] 0001 identity — untouched
- [ ] 0002 capabilities — untouched
- [ ] 0003 AI grounding — untouched
- [ ] 0005 media / 0006 biometrics — n/a
- [x] **0012 lifecycle** — `/gifts` now renders inside the theme Shell, so it carries the preview
      banner in non-live states like every other public page.

## 6. Design verdict per theme

Two independent `design-reviewer` rounds against a production build, both designs, 390 / 768 / 1440.
Critiques: `docs/design/critiques/2026-09-07-level09-transport-gifts.md` and `…-round2.md`.

| Surface | Round 1 (D/U/C/Content) | Round 2 | Ship bar is ≥7 all, Usability ≥8 |
|---|---|---|---|
| `/gifts` · Gilded Hour | 5 / 7 / 5 / 4 | **6 / 7 / 5 / 5** | not met |
| `/gifts` · Conservatory | 7 / 7 / 7 / 4 | **7 / 7 / 7 / 5** | Usability short of 8 |
| `/transportation` · Gilded Hour | 4 / 6 / 3 / 7 | **6 / 8 / 4 / 7** | Design/Creativity short |
| `/transportation` · Conservatory | 3 / 6 / 3 / 7 | **5 / 8 / 4 / 7** | Design/Creativity short |

**All six round-1 blockers are closed, and round 2 raised no new one.** Each was re-measured by me
before I acted on it and by the reviewer afterwards:

| Blocker | Closed by | Measurement |
|---|---|---|
| B1 detector `first-viewport-column-overflow` | one full-bleed guest frame | `impeccable detect` exits **0** on all four surfaces (and on `/trip`) |
| B2 pill buttons in both designs | `--radius-button` role token | `border-radius` 0px Gilded Hour / 8px Conservatory, and it propagated to `/rsvp` and `/your-weekend` |
| B3 an unchosen registry provider, named and linked | the built-in rows deleted | no brand in text, accessible names, RSC payload or `list_gift_links` (`"links":[]`) |
| B4 Conservatory on Gilded Hour's type scale | guest kit reads `--type-*` | CV h1 38.25px/400 → 51px; GH 34px/500 uppercase +2.04px → 46.75px; CV `main` left-weighted (was mirrored 376/376) |
| B5 four competing axes per Gilded Hour card | cards inside `Prose` | one prose axis |
| B6 dead-end nav, no switcher | full lifecycle nav + switcher in the guest header | switcher on all four; the reviewer retracted its "dead slugs" half after probing — `/our-story` and `/our-adventures` both 200, and the five items are `NAV_BY_STATE.TEASER` correctly filtered |

**Where the reviewer was wrong, and where I was.** It reported six dead `italic` declarations
including three in `provenance.css`; those three carry no `font-style` — a previous level removed it
and left a comment saying so. But chasing that turned up a source **neither** of us had: a duplicate
`.placeholder { font-style: italic }` in the guest kit, computing on twelve nodes. Its Cinzel-tracking
fix would have tripped the detector's `wide-tracking` rule, which is why case and tracking became one
role token instead. Both corrections are its own; it verified them in round 2.

**Not taken, deliberately:**

1. **`/transportation` through the theme Shell.** That is the whole guest tree including two merged
   level-07 pages; it is level-16 work. The reviewer agreed to defer and named the cost precisely:
   it costs Conservatory more than Gilded Hour, because Gilded Hour's identity lives in type (which
   the guest kit now carries) and Conservatory's lives in ornament. Its `/transportation` is
   correctly aligned but unfurnished — six identical full-width rules. That is the honest reason
   Conservatory scores 5 on Design there while Gilded Hour scores 6.
2. **Gilded Hour's prose measure.** `--gh-prose: 42rem` renders ~85 characters against Josefin Sans
   where its own DESIGN.md asks for 60–70. That is the level-04 theme kit's value on nine merged
   public pages, not this level's; narrowing it changes every Gilded Hour page and needs its own
   review round. Recorded here rather than done quietly. (The rem measure I did introduce brought
   Gilded Hour's `/transportation` to 68 characters.)
3. **The airiness of a page with nothing to click.** At 1440 the Gilded Hour gift sections are ~66%
   empty, because section padding is tuned for cards and there are no cards. That is the content
   gate showing through, not a layout bug, and the fix is the couple choosing a registry — not
   restoring the fake links. What I did do is stop the page claiming "Each link opens the provider's
   own site" when it has no links, and give it the one action that is true: ask us.
4. **The 13.8px `.gh-eyebrow`.** A DESIGN.md type-scale question carried from level 07, agreed by
   the reviewer as not a level-09 regression.

## 7. Accessibility and performance

- **Axe: 0 violations** (WCAG 2.0/2.1/2.2 A + AA) across 8 runs — 2 routes × 2 designs × 2
  viewports — in both review rounds. Manual contrast with effective-background walking: **0
  failures**. **0** horizontal overflow across 12 route/design/viewport combinations. **0** text
  under 17px on `/transportation`; the one instance on `/gifts` is the 13.8px `.gh-eyebrow` above.
- Every placeholder on both pages carries `role="note"` and `data-placeholder="true"`, which is what
  makes the honesty invariant machine-checkable rather than a matter of reading the diff.
- The four maps links had two accessible names between them, for four different destinations; they
  now name the destination and the travel mode.
- Rendered-HTML sweep, 10 public + 4 guest routes × 2 designs, signed in as fixture guest A1:
  **0 occurrences of `TODO(`**, and none of the `(backlog X-00)` / `(planner item X-00)` internal
  references. Re-run after every change in this level.
- 17px body, visible labels, focus visible, reduced motion: inherited from the theme kits, which the
  level-04 and level-05 reviews measured. Motion audit: no findings — all easings ease-out or
  ease-in-out with no overshoot, stagger capped, `prefers-reduced-motion` honoured.
- Print: the guest shell's skip link and header printed on every guest page, because the print rule
  hid `.skip` and the shell's class is `.wp-skip`. Both hidden now.

## 8. Docs and ADRs

- ADRs added/amended: none. ADR-0004's "never merchant of record" is unchanged; §5 above records
  that the *test* of it was wrong, not the decision.
- `docs/content/backlog.md`: unchanged. Two hints moved from `(planner item P-05 / P-07)` onto the
  repo's own `(backlog P-05 / P-07)` convention so the scrub actually matches them — the ids
  themselves are the same items.

## 9. TODO inventory

```
$ grep -rn "TODO(Tyler & Sara)" src | wc -l
106
```

106 markers in source, **0 reaching a guest** in either design on any of the 14 routes swept. The
markers belong in the content record and in admin, where an author needs to see them; the admin
tables print them deliberately and that is not changed here.

## 10. Verdict

**READY WITH FOLLOW-UPS.**

A hostile reviewer's strongest line is that **none of the four surfaces clears the project's own ship
bar** (≥7 on every axis, Usability ≥8), and that is true — Creativity sits at 4–5 on three of them.
It should merge anyway, for a reason the scores themselves make visible: what is short is *ornament
and content*, and what is closed is *everything that was wrong*. Both Content scores rose only from
4 to 5, and they are capped by the couple's content gate, not by code — a gifts page cannot score
well while the couple have not chosen a registry, and inventing one is exactly the defect this PR
exists to remove. `/transportation`'s Creativity is capped by the deliberate deferral in §6, which
the reviewer endorsed with its cost stated.

What a reviewer should hold me to instead, and what this PR delivers: six blockers closed and
re-measured; the detector at 0 on every surface; axe at 0 across eight runs; three dead internal
links removed, one of them the primary action for an invited guest, live since level 06; five
guest-facing paths that printed the authoring marker fixed at the domain boundary; an invented
registry brand removed from the page, the payload and the AI's answer; and six tests that asserted
the defect rewritten to assert the guarantee, two of them proved by watching them fail first.

Follow-ups, in the level that owns them: the guest tree onto the theme Shell and Gilded Hour's prose
measure (16, quality); the `--type-label-caps-size` floor (a DESIGN.md question); and the content
gate itself, which is step 3 of the plan and the only thing that moves Content past 5.
