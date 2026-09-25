# Tyler & Sara — wedding website

A wedding website that is meant to be *very* well designed: Sara and Tyler's
weekend at the Chicago Athletic Association, in the Botanical–Deco design they
approved. Next.js 16, React 19 and Tailwind v4, with the design toolchain and
quality gates that built it.

## See it

[![Home](docs/demos/home.gif)](docs/demos/home.mp4)

[![Our Story: the chapter reader](docs/demos/our-story.gif)](docs/demos/our-story.mp4)

More in [`docs/demos/`](docs/demos/README.md): Our Venue, Your
Weekend with the RSVP, and the phone view. They are recorded from the running
site with Vercel's [webreel](https://github.com/vercel-labs/webreel) and
[agent-browser](https://github.com/vercel-labs/agent-browser)
(`npm run demos:record`; see [how](docs/ops/demos.md)).

## What's here

- **`DESIGN.md`** — the design system in [Google's DESIGN.md format](https://github.com/google-labs-code/design.md): tokens in YAML, rationale in prose. Linted for structure and WCAG contrast; exports to Tailwind v4 / DTCG.
- **`PRODUCT.md`** — who the site is for and what it must do (impeccable's product brief).
- **`.claude/skills/`** — 21 agent skills: [impeccable](https://impeccable.style) (23 design commands + 61-rule anti-slop detector), [hallmark](https://github.com/nutlope/hallmark), [design-anti-slop](https://github.com/prathameshagrawal/design-anti-slop), Anthropic's [frontend-design](https://github.com/anthropics/skills), Vercel's [web-design-guidelines](https://github.com/vercel-labs/agent-skills), [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [design-motion-principles](https://github.com/kylezantos/design-motion-principles), Addy Osmani's [web-quality-skills](https://github.com/addyosmani/web-quality-skills), [Higgsfield](https://github.com/higgsfield-ai/skills) generate + Soul ID, Google [Stitch](https://github.com/google-labs-code/stitch-skills) design-md / taste-design / enhance-prompt / site-md, plus two custom skills: `wedding-site-standards` and `design-review`.
- **`.mcp.json`** — [fal.ai](https://fal.ai/docs/documentation/setting-up/mcp), [Higgsfield](https://higgsfield.ai/mcp), Google Stitch, Playwright, Context7.
- **Linters & CI** — `@google/design.md`, `impeccable detect`, stylelint, axe-core via Playwright; `.github/workflows/design-quality.yml`. The same design linters run as a git pre-commit hook over staged files (`.githooks/pre-commit`, `scripts/precommit.mjs`).

## Quickstart

```bash
nvm use                      # Node 22
npm install                  # also wires git's pre-commit design gate (.githooks/)
cp .env.example .env         # add FAL_KEY / STITCH_API_KEY; Higgsfield uses `npx higgsfield auth login`
npm run quality              # DESIGN.md lint + anti-slop detect + stylelint
claude                       # then: /impeccable shape home   (or read CLAUDE.md)
```

## Workflow

Every page goes sitemap → wireframe → skeleton → placeholder → real, each
stage its own deployable project in [`stages/`](stages/README.md) that builds on
the one before it (`npm run stages:dev` runs all four).

1. Fill the `TODO(Tyler & Sara)` items in `PRODUCT.md` (date, venue, logistics).
2. `npm run dev` serves the site on http://localhost:3000 (PGlite, migrated and seeded on start).
3. Build each route with `/impeccable craft <route>`; review with `design-review <route>`.
4. Ship when `design-review` scores ≥ 7 on every axis (Usability ≥ 8) and CI is green.
5. When a page visibly changes, re-record its demo (`npm run demos:record -- <name>`).

See `CLAUDE.md` for the full agent guide and `docs/research/` for the tooling research.
