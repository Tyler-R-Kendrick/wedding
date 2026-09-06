# Design changelog

One entry per accepted design change. Token changes cite the
`npx design.md diff` output; direction changes cite the critique or the
couple's decision. Newest first. Process: [`../sdlc/PROCESS.md`](../sdlc/PROCESS.md) Stage 9.

## 2026-09-05 — Baseline: brief consolidated, two themes chosen, SDLC established

**Level:** `claude/wedding-02-design-sdlc` (stack level 02, on top of the
level-01 design toolchain).

**Toolchain baseline (carried from level 01).** 21 agent skills in
`.claude/skills/` (impeccable 4.2.0 with the 61-rule detector, hallmark,
design-anti-slop, frontend-design, web-design-guidelines, ui-ux-pro-max,
design-motion-principles, Addy Osmani's web-quality set, Higgsfield, Google
Stitch set, plus the custom `wedding-site-standards` and `design-review`);
Google `design.md` linter and exporters; stylelint font bans; axe via
Playwright; CI `quality` + `a11y`; `.impeccable/config.json` with
`buildPath: "comp"`.

**Brief consolidated.** `docs/design/brief.md` is the single source of
wedding facts with provenance: Saturday, July 17, 2027 at the Chicago
Athletic Association Hotel; Bustle & Lace planning; ≈142-person universe
incl. 28 children; photo/video/HMUA vendors; memory places; venue history
and spaces; the stale-kit warning; rights and legal gates. Everything
"NOT settled" is listed in `docs/content/backlog.md`.

**Two themes chosen (Tyler).** Gilded Hour (Art Deco; Cinzel / Josefin
Sans / Big Shoulders Display; curtains, elevator doors, engraved reveals)
and Conservatory (Botanical; Gloock / Spectral / Cardo italic; leaves
settling, soft parallax) — two complete designs over one content layer
(ADR-0009). Tokens move to `src/themes/<id>/DESIGN.md`; the root
`DESIGN.md` "Editorial Romance" (Libre Caslon Display / Newsreader /
terracotta) is superseded pending a decision on whether it survives as a
shared-foundation file (design-doc §11 Q3).

**SDLC established.** `docs/sdlc/PROCESS.md` (nine stages with gates,
skill matrix, theme rule, imagery policy, fact policy); templates for
self-review, design critique, ADR, PR, inspo board; ADR-0001 … ADR-0012
accepted; `docs/design/design-doc.md` as the living design document;
`PRODUCT.md` updated with confirmed facts, full IA, lifecycle, themes, and
legal gates.

**No tokens shipped yet.** First `design.md diff` between the two theme
files lands with the theme DESIGN.md files (Stage 3).

## 2026-09-05 — Level 02: two theme systems committed

- `src/themes/gilded-hour/DESIGN.md` and `src/themes/conservatory/DESIGN.md`
  both lint clean (0 errors, 0 warnings). Token diff Gilded Hour → Conservatory:
  colors: +8 −4 ~0; typography: +2 −1 ~0; rounded: +1 −0 ~0; spacing: +0 −1 ~0; components: +14 −8 ~0.
- Inspo boards: `docs/design/inspo/gilded-hour.html`, `docs/design/inspo/conservatory.html`
  (screenshot-verified at 390 and 1440; fonts load from Google Fonts until
  level 04 self-hosts them).
- Procedural art: 11 SVGs per theme under `public/assets/art/<theme>/`.
- Licensed placeholder photography: 4 Wikimedia Commons files with ledger.

## 2026-09-05 — Level 05: the content pages in both designs

- Every level-05 page (Our Story, Our Adventures + one adventure, Share an
  Adventure + one recommendation, Explore CAA + one space, The Wedding, Ask Us)
  renders through `theme.content[page]`. `src/themes/content-types.ts` carries the
  `ContentKit` / `ContentRecipes` contracts; `src/app/(public)/_recipes` resolves
  the request's design, builds the page frame and falls back to Swarm C's plain
  recipes for an unknown design.
- Gilded Hour adds: the gold spine (Our Story), the ledger (the archive and the
  outlets), the diptych (the two voices), the floor plan with corner brackets
  (the four spaces), docent numerals ("look for this"), the programme on the
  spine, the FAQ column. Conservatory adds: the dashed stem with a leaf per
  chapter, the mount of pressed specimen cards, kraft filter tags, the two-voice
  pair, jar labels for operational rows, field notes for cited statements, the
  leaf checklist and the vine programme.
- Typography correction in Gilded Hour: sentences are set as sentences. External
  handoffs, outlet names and itinerary titles lose the deco caps and the display
  tracking that came with their type role; short labels, plaques, room and
  recommendation names keep them. Conservatory status chips drop the small-caps
  tracking for the same reason.
- 390-first: every content page's primary action now sits inside the first screen
  above the fixed bottom chrome. Page heads are tighter on phones, the search
  keeps its button beside its field at every width, the recommendation page leads
  with its handoff, and Ask Us and a room page are no longer numbered acts.
- Shared provenance UI: `.placeholder` was claimed by both the kits' inline
  editorial marker and Swarm C's placeholder block, and the unlayered component
  stylesheet silently won — the kits' marker is now `.todo`. The block exposes
  `--prov-note-ink` / `--prov-external-ink` / `--prov-external-line`, which
  Conservatory fills with soil because pollen is an accent there and never text.
- Evidence: live `impeccable detect` exit 0 on all nine pages × both designs (and
  Home); axe-core WCAG 2.2 AA clean at 390 / 768 / 1440 on all eighteen;
  `tests/e2e/content-themes.spec.ts` covers landmarks, one H1, each design's own
  structure with the other's absent, and the phone fold. Critiques:
  `docs/design/critiques/2026-09-05-<page>-<design>.md` (eighteen files).

## 2026-09-05 — Level 04: theme engine, both kits, Home per lifecycle state

- Theme engine (`src/themes/{types,registry,resolve,routes,server}`): `?theme=` →
  cookie → default, resolved in `src/proxy.ts`; public Home is statically rendered
  per theme under `/t/<theme>` (SSG), previews and personalized routes are
  `private, no-store`. `data-theme` is set server-side (no flash); only the
  active theme's three fonts are preloaded.
- Tokens: `npm run design:sync` generates `src/themes/<id>/theme.css` and the
  Tailwind `@theme` block from each theme's `DESIGN.md`; `design:sync:check` is
  part of `verify`. Gilded Hour `DESIGN.md` gained the `label-sm` (12px) step
  its prose already specified.
- Fonts self-hosted (Latin subsets, OFL texts alongside): Cinzel, Josefin Sans,
  Big Shoulders Display; Gloock, Spectral, Cardo italic. 180 KB total, three
  files per theme, metric-matched `local()` fallbacks.
- Kits and Home recipes for both themes across all nine lifecycle states;
  Gilded Hour = numbered acts on one axis, elevator panel, curtain reveal;
  Conservatory = pressed-flower cards on a kraft tag rail, sky washes,
  leaves settling. Countdown in America/Chicago, hidden on the day.
- Design switcher (server action → `navigate_to` → cookie), `FLAG_DESIGN_SWITCHER`.
- Critiques: `docs/design/critiques/2026-09-05-home-{gilded-hour,conservatory}.md`
  (Swarm B self-critique), `…-review.md` (independent round 1, six blockers,
  fixed by Swarm B) and `…-re-review.md` (round 2, three blockers, fixed by the
  integrator: cookie-dependent `/` is `private, no-store`, panel labels wrap,
  Menu sheet focus, live-region announcement, Ask Us before Photos in TEASER).
- Detector: `cream-palette` waived with reason in `.impeccable/config.json`
  (the brief pins the marble and herbarium-paper grounds); `src/themes/*/fonts.css`
  ignored (fallback face names are not DESIGN.md families).
