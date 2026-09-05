# ADR-0008: Application stack

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0001, ADR-0005, ADR-0007, ADR-0009, `CLAUDE.md` › Stack, `PRODUCT.md` › Constraints |

## Context

`CLAUDE.md` and `PRODUCT.md` recommended Astro or Next.js with Tailwind v4
because `design.md export` emits a Tailwind v4 `@theme` block. The brief
then added authenticated surfaces (Your Weekend), an AI concierge, guest
uploads, provider adapters, and two switchable themes. That needs a server,
a database, auth, storage, and a model layer — while keeping the design
toolchain (impeccable detector, stylelint, axe) that targets `src/`.

## Decision

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16, App Router, TypeScript** | Server components + server actions for capabilities; `proxy.ts` for theme/lifecycle rewrites (ADR-0009, ADR-0012); Vercel hosting |
| Styling | **Tailwind v4** with per-theme CSS variables exported from `src/themes/<id>/DESIGN.md` (`npx design.md export --format css-vars`) | Tokens stay in DESIGN.md; `@theme` maps variables, components never see hex |
| Database (dev/test) | **Drizzle ORM + PGlite**; pgvector via `@electric-sql/pglite-pgvector`, with an in-memory cosine fallback when the extension is unavailable | Real Postgres semantics in CI without a service; retrieval (ADR-0003) testable offline |
| Database (prod) | **Supabase Postgres** (pgvector enabled) via Drizzle | Managed Postgres; same schema and migrations as dev |
| Auth | **Better Auth** with `emailOTP`, `@better-auth/passkey`, `@better-auth/drizzle-adapter` | ADR-0001: OTP claim, optional passkeys, no passwords |
| Storage | **S3-compatible** interface: local filesystem in dev, **Cloudflare R2** in prod | ADR-0005: private originals, signed derivatives |
| AI | **Vercel AI SDK 7**; provider chosen via adapter (ADR-0007); **mock models in CI** | Structured tool calling for capabilities; deterministic evals |
| Tests | **Vitest** (unit, integration on PGlite), **Playwright** (e2e), **axe-core** via Playwright | Existing `tests/a11y.spec.ts` and CI carry over |
| Hosting | **Vercel** | Preview URLs feed `design-review`, `web-quality-audit`, and the `a11y` gate |

Conventions:

- Source in `src/`: `app/` (routes), `themes/<id>/` (DESIGN.md, tokens.css,
  kit expressions, recipes), `components/` (shared kit contracts),
  `capabilities/`, `domain/` (schema, lifecycle), `providers/`, `content/`.
- Only `capabilities/` touches the database (ADR-0002). Only `providers/`
  touches vendors (ADR-0007).
- Fonts self-hosted via `next/font/local`; ≤ 3 files per theme.
- Guest routes are `noindex`; the public teaser is the only indexable page.
- CI gates (`quality`, `unit`, `integration`, `e2e`, `evals`, `security`,
  `a11y`) map to `npm run quality`, `npm run test:unit`,
  `npm run test:integration`, `npm run test:e2e`, `npm run test:evals`,
  `/security-review` (manual, recorded in the self-review), and
  `npm run test:a11y` against the preview URL.

## Consequences

**Positive.** One language and one runtime; tokens flow from DESIGN.md
without hand-copying; CI needs no external services or keys; prod is
managed.

**Negative / costs.** Heavier than a static site; `PRODUCT.md`'s "low ops,
static site, no accounts" is superseded (accounts exist but are invisible —
ADR-0001). PGlite ≠ Postgres in edge cases; run the integration suite
against Supabase branches before release. Next.js major upgrades are a
recurring cost until `ARCHIVE`.

**Follow-ups.** Scaffold at stack level 03 (ADR-0010). Update
`.impeccable/config.json` ignores and `stylelint` ignore list if paths move.
Archive plan: static export of the archive state at `ARCHIVE` so the site
can outlive the database.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Astro + islands + form service | No server model for capabilities, auth, uploads, or the concierge; would end up bolting on a second app |
| Supabase Auth instead of Better Auth | Weaker fit for OTP-first + passkeys with a custom binding model; Drizzle adapter keeps auth tables in our schema |
| Postgres in Docker for tests | Slower CI, fails in sandboxed agent sessions; PGlite runs in-process |
| S3 directly | R2 has no egress fees for a photo archive; interface keeps S3 possible |

## Compliance

- `npm run quality` green; `tests/` mirror the seven gates.
- No vendor SDK imported outside `src/providers/`.
