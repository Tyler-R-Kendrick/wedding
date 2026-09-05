# Tyler & Sara — wedding website

A wedding website that is meant to be *very* well designed. This repo
currently contains the design toolchain, design system, and quality gates;
the site itself is the next step.

## What's here

- **`DESIGN.md`** — the design system in [Google's DESIGN.md format](https://github.com/google-labs-code/design.md): tokens in YAML, rationale in prose. Linted for structure and WCAG contrast; exports to Tailwind v4 / DTCG.
- **`PRODUCT.md`** — who the site is for and what it must do (impeccable's product brief).
- **`.claude/skills/`** — 21 agent skills: [impeccable](https://impeccable.style) (23 design commands + 61-rule anti-slop detector), [hallmark](https://github.com/nutlope/hallmark), [design-anti-slop](https://github.com/prathameshagrawal/design-anti-slop), Anthropic's [frontend-design](https://github.com/anthropics/skills), Vercel's [web-design-guidelines](https://github.com/vercel-labs/agent-skills), [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [design-motion-principles](https://github.com/kylezantos/design-motion-principles), Addy Osmani's [web-quality-skills](https://github.com/addyosmani/web-quality-skills), [Higgsfield](https://github.com/higgsfield-ai/skills) generate + Soul ID, Google [Stitch](https://github.com/google-labs-code/stitch-skills) design-md / taste-design / enhance-prompt / site-md, plus two custom skills: `wedding-site-standards` and `design-review`.
- **`.mcp.json`** — [fal.ai](https://fal.ai/docs/documentation/setting-up/mcp), [Higgsfield](https://higgsfield.ai/mcp), Google Stitch, Playwright, Context7.
- **Linters & CI** — `@google/design.md`, `impeccable detect`, stylelint, axe-core via Playwright; `.github/workflows/design-quality.yml`.

## Quickstart

```bash
nvm use                      # Node 22
npm install
cp .env.example .env         # add FAL_KEY / STITCH_API_KEY; Higgsfield uses `npx higgsfield auth login`
npm run quality              # DESIGN.md lint + anti-slop detect + stylelint
claude                       # then: /impeccable shape home   (or read CLAUDE.md)
```

## Workflow

1. Fill the `TODO(Tyler & Sara)` items in `PRODUCT.md` (date, venue, logistics).
2. Pick the stack (Astro or Next.js + Tailwind v4 recommended) and scaffold into `src/`.
3. `npm run design:export:tailwind > src/styles/theme.css` — tokens flow from `DESIGN.md`.
4. Build each route with `/impeccable craft <route>`; review with `design-review <route>`.
5. Ship when `design-review` scores ≥ 7 on every axis (Usability ≥ 8) and CI is green.

See `CLAUDE.md` for the full agent guide and `docs/research/` for the tooling research.
