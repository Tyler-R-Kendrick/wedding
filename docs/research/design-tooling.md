# Research: AI design tooling for the wedding site (Sept 2026)

Goal: find and install the strongest current tools for *designing*,
*reviewing*, and *generating assets for* a website with an AI coding agent,
with an emphasis on avoiding generic "AI slop" and reaching award-level
craft. Everything below is installed and configured in this repo.

## Requested tools

### impeccable (pbakaus) — installed
- Design vocabulary for agents: 23 commands under `/impeccable` (init,
  shape, craft, critique, audit, polish, bolder, quieter, distill, harden,
  onboard, animate, colorize, typeset, layout, delight, overdrive, clarify,
  adapt, optimize, document, extract, live).
- `npx impeccable detect` — 61 deterministic anti-pattern rules (side-tab
  borders, purple gradients, glows, overused fonts, gray-on-color, low
  contrast, flat type hierarchy, skipped headings…). Exit 2 = findings.
- Design hook: runs the detector after Edit/Write on UI files and a deep
  pass on Stop. Wired in `.claude/settings.json`.
- Writes `PRODUCT.md`, `DESIGN.md` (Google Stitch format), `.impeccable/config.json`.
- Install note: the CLI's engine could not download the skill bundle
  through this sandbox's TLS-intercepting proxy, so the official
  "universal" bundle was fetched with curl and its `.claude/` payload
  vendored (skill 4.2.0, engine 0.1.0). Same result as `npx impeccable install --project`.
- Sources: <https://github.com/pbakaus/impeccable>, <https://impeccable.style/tutorials/getting-started/>

### Google DESIGN.md + linter — installed
- Open format from Google Labs (Stitch), open-sourced April 2026: YAML
  tokens (colors, typography, rounded, spacing, components with `{ref}`
  syntax) + Markdown sections in canonical order.
- CLI `@google/design.md@0.4.0`: `lint` (11 rules incl. `contrast-ratio`
  WCAG AA, `broken-ref`, `orphaned-tokens`, `section-order`), `diff`,
  `export` (`css-tailwind` = Tailwind v4 `@theme`, `json-tailwind`, `dtcg`,
  `css-vars`), `spec`.
- Our `DESIGN.md` lints with 0 errors / 0 warnings. Note: component
  sub-tokens are limited to backgroundColor, textColor, typography,
  rounded, padding, size, height, width — borders/outlines go in prose.
- Companion Stitch skills installed: `design-md`, `taste-design`,
  `enhance-prompt`, `site-md` (need the Stitch MCP; `STITCH_API_KEY`).
- Sources: <https://github.com/google-labs-code/design.md>,
  <https://www.npmjs.com/package/@google/design.md>,
  <https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/>,
  <https://github.com/google-labs-code/stitch-skills>

### fal.ai — configured
- Hosted MCP `https://mcp.fal.ai/mcp`, Bearer `FAL_KEY`; 11 tools
  (search_models, get_model_schema, get_pricing, run_model, submit_job,
  check_job, get_job_result, cancel_job, upload_file, recommend_model,
  search_docs). `@fal-ai/client@1.10.1` for scripts (`scripts/fal-generate.mjs`).
- Source: <https://fal.ai/docs/documentation/setting-up/mcp>

### Higgsfield — configured
- Official MCP (Apr 30 2026) `https://mcp.higgsfield.ai/mcp`, OAuth, 30+
  models (Soul 2.0, Cinema Studio, Kling 3, Seedance, Nano Banana Pro,
  GPT Image 2, Veo…). CLI `@higgsfield/cli@1.1.24` (`higgsfield auth login`).
  Official skills `higgsfield-generate` and `higgsfield-soul-id` installed
  (the docs recommend the CLI path for Claude Code).
- Sources: <https://higgsfield.ai/mcp>, <https://higgsfield.ai/cli>,
  <https://github.com/higgsfield-ai/skills>

### "Anti-slop" — installed (three layers)
- `hallmark` (Nutlope / Together AI, ~28k stars): build/audit/redesign/study
  verbs, 57 slop gates, structural variety, six-axis self-critique.
- `design-anti-slop` (prathameshagrawal): 25-pattern catalog across
  visual/structural/conceptual layers; pre-generation brief + post-gen audit.
- `frontend-design` (Anthropic, ~854k installs): aesthetic direction before code.
- Plus impeccable `detect` (deterministic) and stylelint font bans.
- Sources: <https://github.com/nutlope/hallmark>,
  <https://github.com/prathameshagrawal/design-anti-slop>,
  <https://github.com/anthropics/skills>, <https://skills.sh/anthropics/skills/frontend-design>

## Additional SOTA tools adopted

| Tool | Why | Source |
|---|---|---|
| Vercel `web-design-guidelines` | 100+ interface rules (a11y, focus, forms, motion, typography, images, dark mode, touch, i18n); fetches the live rule set | <https://github.com/vercel-labs/agent-skills> |
| `ui-ux-pro-max` | 74 font pairings, 192 palettes, 119 UX guidelines, searchable locally | <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> |
| `design-motion-principles` | Motion audit lens (Emil Kowalski / Jakub Krehel / Jhey Tompkins) with anti-slop motion checklist | <https://github.com/kylezantos/design-motion-principles> |
| Addy Osmani `web-quality-skills` | Lighthouse-style audits: web-quality-audit, accessibility (WCAG 2.2), core-web-vitals, performance, seo, best-practices | <https://github.com/addyosmani/web-quality-skills> |
| Playwright MCP + `@axe-core/playwright` | Screenshots at phone/tablet/desktop for visual review; automated WCAG 2.2 AA checks | <https://github.com/microsoft/playwright-mcp> |
| `skills` CLI (Vercel) | Install/update skills from any repo; `skills-lock.json` | <https://github.com/vercel-labs/skills> |
| stylelint + `stylelint-config-standard` | CSS hygiene; bans slop font stacks and named colors | <https://stylelint.io> |
| Context7 MCP | Version-accurate framework docs during build | <https://github.com/upstash/context7> |

Considered, not installed (overlap or not needed yet): Koomook
`claude-frontend-skills`, `avoid-ai-design`, `taste-skill`, Storybook MCP,
Chrome DevTools MCP, 21st.dev Magic, shadcn MCP. Revisit once the stack is
chosen. A Figma MCP is available in Claude's connector list if comps move
to Figma.

## Curated overview used
- <https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit>
- <https://www.firecrawl.dev/blog/best-claude-code-skills>
- <https://claudeskills.info/best/frontend-design-skills/>
