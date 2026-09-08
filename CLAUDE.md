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
6. **Assets — fal.ai and Higgsfield.** Mood boards, comps, textures,
   placeholder imagery, and (with the couple's consent and photos) a
   Higgsfield **Soul** for identity-consistent imagery. AI imagery is
   never shipped as a "photo of the couple".
7. **Stitch (Google) — `enhance-prompt`, `taste-design`, `design-md`, `site-md`.**
   Optional comp generator; needs `STITCH_API_KEY`. `taste-design` can
   draft an alternative DESIGN.md to compare against ours.

## Commands

```bash
npm run design:lint            # Google design.md linter (structure + WCAG contrast); must be 0 errors
npm run design:export:tailwind # DESIGN.md → Tailwind v4 @theme CSS
npm run design:export:dtcg     # DESIGN.md → W3C design tokens JSON
npm run slop:detect            # impeccable's 61 anti-slop rules over the repo (exit 2 = findings)
npm run lint:css               # stylelint (bans Inter/Roboto/Arial/Helvetica/Fraunces/… in CSS)
npm run test:a11y              # axe-core WCAG 2.2 AA via Playwright (needs BASE_URL)
npm run quality                # design:lint + slop:detect + lint:css (what CI runs)
npm run skills:list            # installed agent skills
npm run skills:update          # update skills from their repos (skills-lock.json)
node scripts/fal-generate.mjs "prompt"   # quick fal.ai image for a mood board (needs FAL_KEY)
```

Inside Claude Code: `/impeccable <cmd> <target>`, `hallmark audit <target>`,
`design-review <route|file|url>`, `/mcp` to authorize Higgsfield.

## Secrets & accounts

Credentials come through the **Secret Drop** ladder, not through chat. Never ask the couple
what the site needs — `src/lib/env.ts` and `PRODUCT.md` already say. `npm run secrets:acquire`
takes no arguments: it mints, derives, self-registers (auth.md / WorkOS) or delegates every
credential the site needs, and only falls back to asking a human.
Full protocol: `docs/ops/secrets.md`.

```bash
npm run secrets:autofill   # 19 variables that need no account at all — run first in a fresh sandbox
npm run secrets:plan       # what it will do, and what (if anything) a human would click
npm run secrets:acquire    # run the ladder (no args); writes .env, emits .secrets/outbox.json
npm run secrets:resume     # finish delegated ceremonies the couple has since approved
npm run secrets:verify     # probe what landed: live / rejected / unreachable
npm run secrets:page       # rebuild the Secret Drop artifact after a registry change
npm run secrets:probe      # which providers let an agent register itself (--register to prove it)
npm run secrets:harness    # AI sessions this machine already holds (--apply to borrow one)
npm run secrets:serve      # the same page as a local web app on 127.0.0.1 — no Claude in the loop
npm run secrets:verify:lifecycle  # press the page's buttons for real; fails if a control claims work it never does
npm run secrets:verify:artifact   # the page as the published artifact: every control ends somewhere, none queue
```

- Every connection is a **slot** with several **provider options** (storage can be R2, S3, B2,
  Supabase or MinIO). Whatever the choice implies — endpoints, regions, bucket names — is
  computed, never asked. Only the irreducible secret can reach a field.
- The page has three homes and one codebase: published as an artifact, served by
  `npm run secrets:serve` on loopback (files under `.secrets/` are the store, and it decrypts
  and writes `.env` itself — no courier), or opened off disk (seals into a bundle you paste).
- **Every strip leads with acquiring the credential, never with a field**, and every control is
  named for what it does — the label is the ceremony's own `start` verb from `registry.mjs`, never
  a phrase written in the template. Of the three OAuth steps only discovery/registration and the
  token exchange need CORS; **authorization is a navigation and needs none**. So clients are
  registered at build time in Node (`oauth-clients.mjs`, cache committed — public `client_id`s,
  never a secret) and the published page opens the provider's real authorization URL itself for
  Resend, Cloudflare (R2 + Stream), Neon and OpenRouter. Supabase issues only confidential clients
  and Vercel publishes no registration endpoint, so those two still ask Claude through
  `handoffs/<slot>`. `signin` options publish no agent route at all (probed), so there signing in
  yourself *is* the ceremony. A self-serve key page appears for a `link` option only *after* an ask
  goes 45s unanswered, beside the ask rather than in place of it. Two rules that hold everywhere:
  no control may name a terminal command, and no control may repeat a request nobody answered.
- In the artifact case the agent is still the courier for what it can help with: mirror
  `.secrets/outbox.json` into the page's store (`status/*`, `ceremonies/*`), copy `choices/*` back
  to `.secrets/choices.json`, and drop sealed OAuth codes into `.secrets/inbox/` before
  `secrets:resume`. A `handoffs/*` record means someone asked for help: `kind: signin` →
  `node scripts/secrets/browser-capture.mjs relay <recipe>` (the record's `recipe`, not its host);
  `kind: link` → start that option's OAuth or device ceremony.
- Never lead with "paste your key". Acquiring it is the agent's job; a field is the last
  resort, for someone who already holds a key and would rather not wait.
- The concierge's default is **no account at all**: the guest's own browser via the Prompt API
  (`src/lib/ai/browser-model.ts`), then a harness this machine is already signed in to
  (`secrets:harness`), and only then a hosted provider. A borrowed session is the operator's
  identity — local development only.
- **Never assert what a provider supports — probe it.** `npm run secrets:probe` checks RFC
  9728/8414 metadata and RFC 7591 registration; `--register` proves an advertised endpoint
  honours a request. Cloudflare, Neon, Supabase, Resend and Vercel all register an agent
  client with no human at all. Looking only for WorkOS's `agent_auth` at an apex domain finds
  none of them, and concluding "no agent auth exists" from that is how this got it wrong once.
- Higgsfield: `npx higgsfield auth login` (browser), then `/mcp` → higgsfield.
- Never read, print, or commit `.env` or `.secrets/private*`; `.claude/settings.json` denies
  both. Report variable *names* and lengths, never values.

## Rules for UI work in this repo

- Mobile (390px) first. Grandparents are a primary audience: WCAG 2.2 AA,
  17px body text, visible labels, keyboard-complete RSVP.
- Use tokens from `DESIGN.md` (via the Tailwind export or CSS vars). Raw
  hex or `font-family` literals in components are review findings.
- No Inter/Roboto/Arial/Helvetica/Space Grotesk/Fraunces/Playfair/
  Cormorant; no purple gradients, glassmorphism, glows, bento grids,
  hero + 3 cards, bounce easing.
- Before calling a page done: run `design-review`, then `npm run quality`.
- Placeholder facts use `TODO(Tyler & Sara)`; never plausible fiction.

## Stack (chosen; level 03 foundation)

**Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + TypeScript 6**,
**Drizzle ORM** on **PGlite** locally (`./.data/pglite`, `memory://` in tests)
or **Postgres** when `DATABASE_URL` is set, **Better Auth** (auth swarm),
**Vercel AI SDK** (`ai`, Anthropic/OpenAI/Voyage adapters), **pino** logs,
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
