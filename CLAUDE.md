# Tyler & Sara's wedding website — agent guide

This repo is set up so that every UI task runs through a curated design
toolchain. Read this file, then `PRODUCT.md` and `DESIGN.md`, before
touching any UI. The site itself is not built yet; the tooling is.

## Ground truth files

| File | Role | Owner |
|---|---|---|
| `PRODUCT.md` | Audience, purpose, constraints, voice, anti-references, planned routes. `TODO(Tyler & Sara)` marks facts only the couple can supply — never invent them. | impeccable `init` |
| `DESIGN.md` | Design tokens (YAML) + rationale, in Google's DESIGN.md spec. The single source of truth for colors, type, spacing, components. Export it; don't hand-copy values. | Google `design.md` + impeccable |
| `.impeccable/config.json` | Build path (`comp`), detector ignores, hook settings. | impeccable |
| `.mcp.json` | fal.ai, Higgsfield, Stitch, Playwright, Context7 MCP servers. | — |
| `.claude/settings.json` | MCP approvals, permission allowlist, impeccable design hook (PostToolUse + Stop). | — |

## Tool layering (who does what)

1. **Direction & build — `impeccable`** (primary workflow).
   `/impeccable shape <surface>` → `/impeccable craft` (comp-first) →
   `/impeccable polish`. Also `critique`, `audit`, `typeset`, `colorize`,
   `animate`, `harden`, `adapt`, `optimize`, `live`. Run
   `.claude/skills/impeccable/scripts/impeccable context` once per session
   as the skill says.
2. **Generation guardrails — `hallmark`, `design-anti-slop`, `frontend-design`.**
   They fire automatically when you build UI. hallmark enforces structural
   variety and 57 slop gates; design-anti-slop forces a brief before
   generation and audits after; frontend-design sets aesthetic direction.
   If they disagree with `DESIGN.md`, `DESIGN.md` wins (the brief wins).
3. **Domain — `wedding-site-standards`.** What a wedding site must contain,
   RSVP rules, copy standards, the Awwwards rubric, study list.
4. **Review — `design-review`** (composes everything below) and the
   `design-reviewer` subagent. Reviewers: `web-design-guidelines` (Vercel,
   100+ rules), `design-motion-principles` (audit mode), `web-quality-audit`
   / `accessibility` / `core-web-vitals` / `performance` / `seo` /
   `best-practices` (Addy Osmani), axe via Playwright, and the deterministic
   `npx impeccable detect`.
5. **Reference data — `ui-ux-pro-max`.** Searchable font pairings, palettes,
   UX guidelines. Use it to *compare* options, not to override `DESIGN.md`.
6. **Generated media — `fal.ai` and Higgsfield, both required.** Image, video
   AND audio. They do different jobs and neither substitutes for the other:
   - **fal.ai** (`FAL_KEY`) — one key across image, video and audio models. Mood
     boards, textures, paper and fabric grounds, section backgrounds, motion
     tests, sound. Called by `scripts/fal-generate.mjs` and the `fal-ai` MCP
     server. Reach for it when nothing has to stay consistent between takes.
   - **Higgsfield** (`npx higgsfield auth login`, the CLI's own OAuth, or `/mcp`
     in Claude Code) — anything that must stay the *same* across shots, plus motion. A **Soul** (with the
     couple's consent and photos) keeps one identity across a series; the video
     models do the camera move and its audio. Skills: `higgsfield-generate`,
     `higgsfield-soul-id`.

   Neither is stock photography: **Openverse** is its own connection (openly
   licensed real work from Flickr, Wikimedia and others), and **Stitch** is its
   own again (screen comps). A generated image is not a licensed photograph and
   the page no longer files them together.

   Order of preference for any image on the site: a real licensed photograph
   first, then a generated texture or abstract ground, and a generated *person*
   last and only via a Soul — a fresh prompt per image gives a different
   stranger each time, which reads as stock and is the tell. AI imagery is
   never shipped as a "photo of the couple", and anything generated is recorded
   in `docs/ops/asset-licensing.md` with the tool and prompt that made it.
7. **Stitch (Google) — `enhance-prompt`, `taste-design`, `design-md`, `site-md`.**
   Optional comp generator; needs `STITCH_API_KEY`. `taste-design` can
   draft an alternative DESIGN.md to compare against ours.

## The build pipeline (stages/)

A page is made in five fidelities, each its own project with its own dev
server, tests, build and deployment, each built from the one before it:
**sitemap** (`stages/01-sitemap`, :3101) → **wireframe** (`02-wireframe`,
:3102) → **skeleton** (`03-skeleton`, :3103, clickable, content as bones) →
**placeholder** (`04-placeholder`, :3104, stand-in copy in every real design,
design picker) → **real** (this app, :3000). Stages 2 to 4 redraw the **baseline**:
every page as production renders it, captured with `npm run stages:capture`
into `stages/02-wireframe/baseline/` (guest and admin pages from the test server
as fixture users), so their layout is the real site's, never a sketch of it. Settle each stage's
question before moving down; fix a problem at the stage that owns it (a wrong
flow is a wireframe fix, not a skeleton patch). Changes cascade down only:
`stages/01-sitemap/lib/sitemap.ts` is the page list every stage reads, the real
nav takes its labels from it, and `tests/unit/stages/sitemap-routes.test.ts`
fails when `src/app` and the sitemap disagree. A new page starts in the
sitemap. The wedding app also serves every stage (`src/lib/stage-hosting.ts`):
`<stage>.dev.kendrick.wedding`, the hub and board at `dev.kendrick.wedding`, and `/<stage>` plus
`/stages` on previews and locally. A settled stage
is recorded with `npm run stages:signoff`; the sign-off goes stale on the board when the page's
wireframe changes. Guide: `stages/README.md`.

```bash
npm run dev:sitemap | dev:wireframe | dev:skeleton | dev:placeholder
npm run stages:dev · stages:test · stages:typecheck · stages:build · stages:serve
npm run stages:assemble && npm run dev   # http://dev.kendrick.localhost:3000, http://sitemap.dev.kendrick.localhost:3000
npm run stages:capture                   # refresh the baseline from production (+ the test server on :3331)
npm run stages:probe                     # every stage address and asset, against the running app
npm run stages:signoff -- <wireframe|skeleton|placeholder> <pageId> --by <name>
```

## Commands

```bash
npm run design:lint            # Google design.md linter (structure + WCAG contrast); must be 0 errors
npm run design:export:tailwind # DESIGN.md → Tailwind v4 @theme CSS
npm run design:export:dtcg     # DESIGN.md → W3C design tokens JSON
npm run slop:detect            # impeccable's 61 anti-slop rules over the repo (exit 2 = findings)
npm run design:drift           # the same, plus any size/colour/radius off the DESIGN.md scale (what CI and quality run)
npm run slop:detect:rendered   # rendered scan: every route × design × 390/820/1280/1440 (needs a server, BASE_URL)
npm run lint:css               # stylelint (bans Inter/Roboto/Arial/Helvetica/Fraunces/… in CSS)
npm run test:a11y              # axe-core WCAG 2.2 AA via Playwright (needs BASE_URL)
npm run quality                # design:lint + slop:detect + lint:css (what CI runs)
npm run precommit              # the pre-commit design gate over staged files (git runs it for you)
npm run hooks:install          # point git at .githooks/ (npm install already does, via `prepare`)
npm run skills:list            # installed agent skills
npm run skills:update          # update skills from their repos (skills-lock.json)
node scripts/fal-generate.mjs "prompt"   # quick fal.ai image for a mood board (needs FAL_KEY)
```

Inside Claude Code: `/impeccable <cmd> <target>`, `hallmark audit <target>`,
`design-review <route|file|url>`, `/mcp` to authorize Higgsfield.

## Secrets & accounts

Credentials live in Vercel's project settings (and, locally, in `.env`), set by the couple or by a
Marketplace connector — never through chat. Never ask the couple what the site needs:
`src/lib/env.ts`, `.env.example` and `docs/ops/environment.md` already say, and a local checkout
needs no account at all (dev defaults, Better Auth, PGlite, local-fs storage, the dev inbox).

- Storage is S3-compatible — R2, B2, Supabase Storage or MinIO — never AWS: `src/providers/storage`
  refuses an Amazon endpoint, or none (which the AWS SDK would resolve to Amazon).
- The concierge uses **no account at all**: answers are written on the guest's own device by the
  browser's built-in model, through the Vercel AI SDK (`generateText` with the `@browser-ai/core`
  provider, `src/lib/ai/browser-model.ts`), and a browser without it gets an answer quoted from the
  site's own pages. The site never calls a hosted model — no Anthropic, no Vercel AI Gateway, no
  OpenAI-compatible vendor, whatever keys are set — and embeddings and photo captions run
  in-process. Never add a hosted AI adapter or an `@ai-sdk/<vendor>` package;
  `tests/unit/ai-model-provider.test.ts` fails if one appears.
- **Gift links are not a credential.** Registry and "next adventures" links live in the
  `gift_links` table and are edited in `/admin/gifts`, which validates every URL against the
  redirect allowlist at write time and again at read time. `REGISTRY_LINKS_JSON` and
  `CASH_FUND_LINKS_JSON` were a second, hand-maintained copy that only applied when that table was
  empty; both are gone.
- Never read, print, or commit `.env` or anything under `.secrets/` (left by the removed Secret
  Drop); `.claude/settings.json` denies the private files and `.gitignore` the folder. Report
  variable *names* and lengths, never values.

## Rules for UI work in this repo

- Mobile (390px) first. Grandparents are a primary audience: WCAG 2.2 AA,
  17px body text, visible labels, keyboard-complete RSVP.
- Use tokens from `DESIGN.md` (via the Tailwind export or CSS vars). Raw
  hex or `font-family` literals in components are review findings.
- No Inter/Roboto/Arial/Helvetica/Space Grotesk/Fraunces/Playfair/
  Cormorant; no purple gradients, glassmorphism, glows, bento grids,
  hero + 3 cards, bounce easing.
- Before calling a page done: run `design-review`, then `npm run quality`.
- Every commit passes the **pre-commit design gate** (`.githooks/pre-commit` →
  `scripts/precommit.mjs`): Google `design.md lint` on each staged DESIGN.md (errors and
  WCAG-contrast warnings block), `design:sync --check` when tokens change, `impeccable detect`
  on staged UI files (plus all of `src/` when DESIGN.md or `.impeccable/config.json` changes;
  anti-patterns and off-scale sizes, colours and radii both block), and stylelint on staged CSS.
- A fluid size runs between ramp steps: `clamp(var(--type-<step>-size), …, var(--type-<step>-size))`.
  A size the ramp lacks goes into that theme's DESIGN.md first (then `npm run design:sync`). A finding is fixed, or waived through `impeccable hooks ignore-value`
  with a reason; `--no-verify` is not a way to land UI work.
- Placeholder facts use `TODO(Tyler & Sara)`; never plausible fiction.

## Stack (chosen; level 03 foundation)

**Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + TypeScript 6**,
**Drizzle ORM** on **PGlite** locally (`./.data/pglite`, `memory://` in tests)
or **Postgres** when `DATABASE_URL` is set, **Better Auth** (auth swarm),
**Vercel AI SDK** (`ai`, plus `@browser-ai/core` for the browser's built-in model; no hosted
adapters), **pino** logs,
**vitest** + **Playwright**. Every product feature is a *capability*
(`src/capabilities`) invoked through one pipeline; every external system is a
*provider* (`src/providers`) with a mock. Read `docs/architecture/*.md` and
`docs/ops/*.md` before adding anything. Packages are fixed: feature swarms do
not add dependencies.

```bash
npm run dev                # http://localhost:3000 (auto-migrates + seeds PGlite)
npm run typecheck · lint · test:unit · test:integration · test:e2e · build
npm run check              # typecheck + lint + unit
npm run verify             # check + lint:css + design:lint + slop:detect + integration + build
npm run db:generate        # drizzle-kit: schema -> src/db/migrations (commit them)
npm run db:migrate · db:seed · jobs:run
```

Layout: `src/app` (routes only), `src/contracts` (shared types, read-only),
`src/capabilities`, `src/policy`, `src/lib`, `src/db` (schema/, migrations/,
seed/, repos/), `src/providers/<kind>/{types,mock,index}.ts`, `tests/{unit,
integration,ui,e2e}`. The Tailwind `@theme` in `src/app/globals.css` is a
placeholder until the design swarm exports `DESIGN.md`.

## Agent sessions: processes and disk

This checkout is about 1.6 GB, and 1.4 GB of that is `node_modules`. If it is much bigger, or a
session has processes you did not expect, something was left running or left behind. A session on
2026-09-24 ended with four shell loops that could never finish, a 5 GB dev server, a 12 GB swap file
and 3.4 GB of `.next`. The rules that prevent it:

- **Never match a process by its command line** (`pgrep -f`, `pkill -f`, `killall`). The Bash tool
  runs every command inside `bash -c "…"`, so the pattern matches the calling shell: a wait on it
  never ends, and a kill of it kills the caller. Keep PIDs (`$!`), or use `pgrep -x <name>`.
- **Bound every wait**: `timeout <seconds>` around any `until`/`while … sleep` loop.
- **One Next server at a time.** A dev server that has compiled every route holds several GB; a
  second server beside it is what ran out of memory. Stop it when you are done. Never add swap.
- **`npm run clean`** stops this checkout's Next servers (found by working directory, never by
  command line) and removes `.next`, test output, demo takes and review screenshots
  (`--data` also drops the local database). Run it before you finish a session that built or served
  the site.

`scripts/agent/bash-guard.mjs` enforces the first three as a PreToolUse hook
(`.claude/settings.json`). It blocks the command and says what to do instead.

## Maintenance

- Skills were installed with `npx skills add … --copy` into `.claude/skills`
  (self-contained, committed). `skills-lock.json` records sources;
  `npm run skills:update` refreshes them. **That command now prompts rather
  than running unattended** (`permissions.ask` in `.claude/settings.json`,
  level-03 review N17, closed at level 15): a vendored skill executes its
  instructions when loaded, so pulling new ones is a reviewed action, not a
  routine one. The same applies to `npx skills *` and the impeccable updates.
- impeccable's skill payload is the official bundle vendored into
  `.claude/skills/impeccable` (skill 4.2.0, engine 0.1.0). The launcher
  downloads the engine binary once into `~/.impeccable/bin/`. Update with
  `npx impeccable update --project --providers=claude`.
- The impeccable hook lives in the committed `.claude/settings.json`; if
  `impeccable hooks on` also writes `.claude/settings.local.json`, delete
  the local copy to avoid running it twice.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
