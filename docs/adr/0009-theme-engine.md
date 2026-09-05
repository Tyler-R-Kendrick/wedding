# ADR-0009: Theme engine — two complete designs over one domain

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0008, ADR-0012, `docs/design/brief.md` §4, `docs/design/design-doc.md` §5–6 |

## Context

Tyler chose two complete, switchable designs: **Gilded Hour** (Art Deco:
marble, gold leaf, sunburst/chevron geometry, symmetry; Cinzel / Josefin
Sans / Big Shoulders Display) and **Conservatory** (Botanical: foliage,
moss, pressed-flower cards, sky washes, organic asymmetry; Gloock / Spectral
/ Cardo italic). They are not a light/dark pair: page structure differs.
Content, facts, RSVP, and every capability are the same.

## Decision

1. **One domain, two themes.** Routes, data, capabilities, copy, and page
   *contracts* (what must be above the fold, what the page must contain)
   are theme-agnostic. Themes own expression only.
2. **Per-theme `src/themes/<id>/DESIGN.md`** in Google's DESIGN.md spec is
   the source of truth for each theme; `npx design.md export --format css-vars`
   emits `tokens.css` scoped under `[data-theme="<id>"]`. Token *names* are
   identical across themes; values differ. `npx design.md diff` between the
   two files is reviewed in every token PR.
3. **Shared kit contract, per-theme expression.** `src/components/` defines
   each kit component's props, slots, a11y behaviour, and states (see
   design-doc §6). `src/themes/<id>/kit/` supplies the theme's expression
   (markup structure may differ, e.g. stepped frame vs. pressed-flower
   card). `src/themes/<id>/recipes/` composes kit components into page
   layouts (symmetric monumental vs. organic asymmetric).
4. **Resolution order:** `?theme=<id>` query → `theme` cookie → default
   (`TODO(Tyler & Sara)`: which theme is default, or random-until-chosen).
   `proxy.ts` (Next.js 16) resolves the theme and **rewrites public routes
   to `/t/[theme]/...`**, so each theme is a real route tree for caching
   and previews while guests see clean URLs.
5. **Switcher visible to everyone until chosen**, as a quiet control in the
   shell (not a modal); after a choice it moves to the footer. The choice is
   per device (cookie), never tied to the guest identity, so it needs no
   auth and leaks nothing.
6. **Both or neither.** A surface ships when both themes pass the critique
   gate; a theme-specific regression blocks the surface.
7. Motion vocabularies are per theme (curtains/elevator/engraved vs.
   leaves settling/soft parallax) and both collapse to the same
   reduced-motion behaviour: opacity only, ≤ 200 ms.
8. Print styles are shared and theme-neutral (logistics pages print in
   black and white).

## Consequences

**Positive.** The couple can keep both directions and let guests (or
lifecycle) choose. Design work is parallelisable per theme. Token diffs
make divergence explicit.

**Negative / costs.** Roughly double design and critique effort; two comp
sets per surface; two screenshot sets per review. A kit contract that fits
two structures must be designed carefully up front. Root `DESIGN.md`
("Editorial Romance") is superseded; `package.json` scripts and CI must lint
both theme files.

**Follow-ups.** Decide the default theme. Extend `design:lint` scripts to
both files. Recipe inventory in design-doc §6. Theme e2e test: cookie
persistence, `?theme=` override, no layout shift on switch.

## Alternatives considered

| Alternative | Why not |
|---|---|
| One theme now, second later | The two directions constrain the kit contract; retrofitting a second structure is a rewrite |
| CSS-variable-only skin | Cannot express structural difference (symmetry vs. asymmetry, frames vs. cards) |
| Separate apps per theme | Duplicates domain, auth, and capabilities; drift guaranteed |

## Compliance

- `npx design.md lint` 0 errors for each theme; diff attached to PR.
- No component imports from `src/themes/<other>/`.
- e2e: every public route renders under both `/t/gilded-hour` and
  `/t/conservatory` with no console errors.
