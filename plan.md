# Sara + Tyler Wedding Experience Platform — build plan and hand-off

> Living plan for the whole build. Anyone (or any agent) can continue from this
> file plus the repo. Last updated 2026-09-08 at level 17, the final level.
>
> **The ladder is complete.** All seventeen levels are merged. What remains is
> content, not code — see §2 and `docs/content/for-sara-and-tyler.md`.

## 1. Context

Tyler's brief (see `docs/design/brief.md`) asks for a complete guest-facing
platform for Sara Fitzgerald + Tyler Kendrick's wedding on **July 17, 2027 at
the Chicago Athletic Association Hotel**: lifecycle-driven public site, story
and adventure graph, CAA docent guide, invitation-link identity with email OTP,
household RSVP and seating, travel/hotel/ride/registry/reservation adapters,
guest media pipeline, semantic media search, feature-gated biometrics,
closed-world AI concierge, WebMCP progressive enhancement, admin, threat model,
evals, and docs. Delivery model: **incremental commits, stacked PRs, adversarial
self-review between levels, parallel subagent swarms integrated one level at a
time** (ADR-0010). Two completely different, switchable designs: **Gilded
Hour** (Art Deco) and **Conservatory** (botanical).

Facts come only from the brief; unknowns are typed `TODO(Tyler & Sara)`
placeholders tracked in `docs/content/backlog.md`.

## 2. Status board

All seventeen levels are merged to `main`. Each row is the squash commit and the
pull request it came from.

| Level | Scope | Merged as |
|---|---|---|
| 01 | Design toolchain, DESIGN.md baseline, quality gates | `93aa863` (#1) |
| 02 | SDLC process, ADRs, brief, two theme systems, inspiration boards, licensed placeholders | `4b7843c` (#2) |
| 03 | Next.js 16 foundation: contracts, capability pipeline, policy, PGlite/Drizzle, 17 provider seams with mocks, jobs, audit, CI | (#4) |
| 04 | Theme engine, public shell, lifecycle, Home per state, design switcher | `1f40044` (#5) |
| 05 | Story, adventures, Share an Adventure, CAA docent, FAQ — nine pages in both designs | `7d64658` (#6) |
| 06 | Identity: invitation claim, email codes, passkeys, step-up, entitlements, admin guest ops | `701e05c` (#7) |
| 07 | RSVP, Your Weekend, seating — and the security suites that were never running | `8fe223b` (#8) |
| 08 | Travel & Stay and the trip bridge | `39119c8` (#9) |
| 09 | Transportation benefits, gifts, reservations | `8b8e06a` (#10) |
| 10 | Media pipeline: uploads, galleries, moderation | `18d4c05` (#11) |
| 11 | Media intelligence and the biometric vault, gated off | `a86c282` (#14) |
| 12 | AI concierge: grounded answers with citations | `c04993d` (#15) |
| 13 | WebMCP: the same capabilities, offered to a browser agent | `310926e` (#16) |
| 14 | Admin operations: the six screens no feature level owned | `9266ddb` (#18) |
| 15 | Security: headers, webhook replay, the guest-identity gap in `authorize()` | `fc9ae86` (#19) |
| 16 | Quality: the carried design debt, and the two trees wearing the wrong fonts | `6af8b64` (#24) |
| 17 | Docs, activation matrix, release evidence, three documentation gates | this level |

Plus the couple-facing content handoff (`4a2fa20`, #17) and the feature labs
(`0973987`, #13).

### The guest-truth series

Six pull requests that are not levels. After the feature ladder was built, the
site was read as a guest would read it, and each round found defects that a
green test suite could not: the site describing a version of itself that does
not exist, or describing the reader as somebody else.

| PR | What a guest was told |
|---|---|
| #20 `3735c86` | Invented hotel and flight prices, shown as live partner rates |
| #21 `09b120c` | A settled fact glued to one nobody had decided; a registry that does not exist |
| #22 `59eb3e8` | Another household's members, inside your own RSVP |
| #23 `59bfc03` | "Sign in" — to a guest already signed in; an OTP lockout with no way out |
| #25 `3c43d80` | Greeted by the household manager's name; "Answered for everyone" after one person |
| #26 | "Claim your invitation" — to a guest who had claimed; travel tools "not live" one tap from the live travel tools |

This is the most transferable finding of the whole run and is written up in
`docs/evidence/final-validation.md`.

### What is left, and it is not code

119 `TODO(Tyler & Sara)` markers and 30 open backlog items. No further
engineering reduces that number; every one needs a decision from the couple, the
planner or a vendor. Start at `docs/content/for-sara-and-tyler.md`.

## 3. Locked decisions

| Area | Decision |
|---|---|
| Stack | Next.js 16 App Router (Turbopack, `proxy.ts`), React 19, TypeScript strict, Tailwind 4 (`@theme` defaults + `[data-theme]` overrides generated from each theme's `DESIGN.md`) |
| Data | Drizzle 0.45; PGlite (`memory://` in tests, `.data/pglite` in dev, `/tmp` on serverless) with `@electric-sql/pglite-pgvector`; Supabase Postgres in production via `DATABASE_URL` (project not created yet: Tyler deferred the $10/month plan) |
| Auth | Better Auth 1.7 (`emailOTP`, `@better-auth/passkey`, `@better-auth/drizzle-adapter`), 5-minute step-up window, invitation link = discovery only |
| Storage | S3-compatible adapter (Cloudflare R2 in production), local filesystem in dev; private originals, signed reads, EXIF/GPS stripped from derivatives |
| AI | Vercel AI SDK 7; Anthropic (`claude-sonnet-5` chat/verifier, `claude-haiku-4-5` captions), mocks in CI; embeddings via Voyage or OpenAI |
| Hosting | Vercel (project link attempted: the connector returned 403 "no permission to create the project"; needs Tyler to grant it or create the project once in the dashboard) + Supabase + R2 |
| Themes | `gilded-hour` (default) and `conservatory`; switcher visible to everyone (`FLAG_DESIGN_SWITCHER`), `?theme=` links, cookie |
| Placeholders | Procedural SVG art (`scripts/art/*`) + Wikimedia Commons CC/PD photos with a hash-verified ledger; AI imagery never shipped as a "photo of the couple" |
| Branching | Stacked PRs; squash-merge at the bottom of the stack; after each squash, rebase the next level with `git rebase --onto origin/main <old-base-head>` |
| Secrets | Local values auto-filled by `scripts/secrets/autofill.mjs`; account keys via Secret Drop; no provider in our stack supports auth.md anonymous registration yet (`scripts/secrets/authmd-discover.mjs`) |

## 4. Architecture in one screen

```
UI (theme recipes) ─┐
Embedded AI tools ──┼─► src/capabilities (registry + invoke pipeline) ─► src/policy ─► src/domain ─► src/providers (mocks by default)
WebMCP tools ───────┘        validate → authorize → step-up → confirm → idempotency → handler → validate → audit
```

- Contracts: `src/contracts/*` (ids, result, errors, principal/entitlements,
  provenance/trust classes, audit, flags, lifecycle, providers, capability).
- Foundation docs: `docs/architecture/{overview,capability-layer,providers}.md`,
  `docs/ops/{local-dev,environment,secrets,asset-licensing}.md`.
- Design: `docs/design/{brief,design-doc}.md`, `docs/design/inspo/*`,
  `src/themes/<id>/{DESIGN.md,design.json}`, `docs/sdlc/PROCESS.md`.
- Swarm work orders: `docs/sdlc/swarms/README.md` + one brief per swarm.

## 5. How to continue in a new session

1. Clone, `npm ci`. Everything runs with no accounts and no keys: `npm run dev`
   migrates and seeds PGlite on first connection. For Playwright, Chromium is at
   `PW_CHROMIUM_PATH` when preinstalled; never run `playwright install` in the
   cloud sandbox.
2. Read `docs/README.md`. It is the index, and `npm run docs:links` fails the
   build if anything on it points at a file that does not exist.
3. Before changing anything, read `docs/architecture/capability-layer.md`.
   Every surface — UI, AI concierge, WebMCP — goes through one `invoke()`
   pipeline, and a feature added anywhere else bypasses authorization, audit and
   provenance in one step.
4. `NEXT_TURBOPACK_ROOT=/home/user npm run verify` before pushing, and note that
   it does **not** run Playwright: the two browser arrangements need
   incompatible servers, and `node scripts/check-spec-coverage.mjs` is what
   guarantees every spec belongs to one of them. The runners are in `.data/run/`.
5. The verification standard in §8 still governs, and so does the rule under it:
   **never weaken a test to pass.**

## 6. Where the level-03 security review went

It is closed. The two blockers and eighteen should-fixes landed before PR 03
opened; the nits deliberately deferred (N2, N8–N11, N15 CSP/HSTS, N17, N18, N20,
N21) landed at level 15, and `docs/reviews/PR-19-self-review.md` records which.
The current security posture — what is worth stealing, what stops it, and the
test that fails if the control goes away — is
`docs/architecture/threat-model.md`, not this section.

## 7. Contract updates already communicated to swarms

- Actions/transactions with `idempotent: true` require an idempotency key
  (ULID) from the caller; the pipeline reserves it first; replay on the same
  payload, 409 on a different one. Anonymous principals may not use keys or
  explicit confirmation.
- Confirmation tokens are single-use and `confirmation: 'explicit'` is
  accepted only from surface `ui`; AI/WebMCP receive
  `confirmation_required {reason:'requires_ui'}`.
- Browser POSTs are always surface `ui`; the concierge and WebMCP bridge set
  the surface server-side. Authenticated POSTs must be same-origin JSON.
- Storage: keys ending `.meta.json`, dot segments, and `/upload.json` are
  rejected; sidecars live under `<dataDir>/meta/`; `uploadId` is a ULID;
  content types are allowlisted at sign time.
- `/api/dev/inbox` requires `NODE_ENV=development` without `VERCEL`/`CI`, or
  a `DEV_INBOX_TOKEN` bearer.
- Citations must use public routes or official URLs, never repo paths.

## 8. Verification standard (every level)

`npm run verify` (typecheck, lint, unit, stylelint, design lint, detector,
integration on PGlite, build), e2e with `BASE_URL` on a per-worktree port,
`npx impeccable detect src/` exit 0, `design-review` scores ≥7 on every
Awwwards axis with Usability ≥8 for UI levels, a self-review file per PR,
and no secrets, guest fixtures, voucher codes, or biometric data in git.

## 9. Open items only Tyler & Sara can resolve

`docs/content/backlog.md` is the complete record: 30 items — C-01…C-10 for the
couple, P-01…P-07 for the planner, V-01…V-03 for vendors, X-01…X-10
cross-cutting. `docs/content/for-sara-and-tyler.md` is the same list in plain
language, each item naming the page it unblocks.

**X-07 deserves singling out:** "how to reach us if you are stuck". Every
recovery path on the site — a wrong code, an expired link, a revoked invitation,
an email that never arrived — ends by pointing at that placeholder. It is the
one gap a code fix cannot close and the most likely thing to strand a real
guest.

Accounts and keys, none of which the site needs to run: a Vercel project, a
Supabase project, an R2 bucket, a Resend domain, and optionally fal.ai / Stitch
keys for generated imagery. `docs/ops/deploy-vercel-supabase.md` is the
sequence; `docs/ops/activation-matrix.md` is what each one turns on.

## 10. Risks

Scope in one run (mitigated by contracts + serial integration); session
usage limits interrupting swarms (mitigated by frequent commits and pushed
branches); PGlite pgvector is early (fallback index exists); no ffmpeg in
the sandbox (provider seam + Playwright's bundled binary); legal gates
(BIPA, professional-media AI rights) stay OFF until counsel/vendor sign-off.
