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
