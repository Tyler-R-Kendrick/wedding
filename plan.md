# Sara + Tyler Wedding Experience Platform — build plan and hand-off

> Living plan for the whole build. Anyone (or any agent) can continue from this
> file plus the repo. Last updated 2026-09-05 by the integrating session
> (https://claude.ai/code/session_015ZSj3WcgMEVfg4Twn7wLs5).

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

| Level | Scope | Branch | State |
|---|---|---|---|
| 01 | Design toolchain, DESIGN.md baseline, quality gates | `claude/wedding-site-design-tools-lhs4i1` | **Merged** (PR #1, squash `93aa863`) |
| 02 | SDLC process, ADRs, brief, two theme systems, inspo boards, licensed placeholders, Secret Drop tooling | `claude/wedding-02-design-sdlc` | **Merged** (PR #2, squash `4b7843c`) |
| 03 | Next.js 16 foundation: contracts, capability pipeline, policy, PGlite/Drizzle, 17 provider seams with mocks, jobs, audit, CI | `claude/wedding-03-foundation` (rebased onto `main`, pushed at `3f5baee`) | **PR open** ([#4](https://github.com/Tyler-R-Kendrick/wedding/pull/4) against `main`): hardening §6 done, verify + e2e green, `docs/reviews/PR-03-self-review.md` READY |
| 04 | Theme engine, public shell, lifecycle, Home (Swarm B) | `claude/wedding-04-themes-lifecycle` (from `swarm/B-themes-lifecycle` `5c475d7`, rebased on 03 `5901831`) | **Integrating**: verify + 39 e2e/axe green, design-reviewer pass, self-review, PR against `claude/wedding-03-foundation` |
| 05 | Story, adventures, recommendations, CAA docent (Swarm C) | `swarm/C-story-adventures-caa` (resumed from checkpoint `b7deccd`, rebasing onto 03 `5901831`) | In progress |
| 06 | Identity, Better Auth, entitlements (Swarm D) | `swarm/D-identity-auth` (pushed at `e3ae640`, rebased on 03 `5901831`, 11 commits) | **Swarm done**, awaiting integration after 05 |
| 07 | Events, RSVP, Your Weekend, seating (Swarm E) | `swarm/E-rsvp-weekend-seating` (resumed from checkpoint `989d6f2`, rebasing onto 03 `5901831`) | In progress |
| 08 | Travel & lodging (Swarm F) | `swarm/F-travel-lodging` (worktree reset to 03 `5901831`) | In progress |
| 09 | Transport, gifts, reservations (Swarm G) | `swarm/G-transport-gifts-reservations` (worktree reset to 03 `5901831`) | In progress |
| 10 | Media pipeline (Swarm H) | `swarm/H-media-pipeline` (resumed from checkpoint `d36f984`, rebasing onto 03 `5901831`) | In progress |
| 11 | Media AI + biometric consent (Swarm I) | `swarm/I-media-ai-biometric` | Not started |
| 12 | AI concierge + evals (Swarm J) | `swarm/J-ai-concierge` | Not started |
| 13 | WebMCP (Swarm K) | `swarm/K-webmcp` | Not started |
| 14 | Admin ops (Swarm L) | `swarm/L-admin-ops` | Not started |
| 15 | Security hardening, threat model (Swarm M) | | Not started |
| 16 | Quality: E2E, a11y, perf, resilience (Swarm N) | | Not started |
| 17 | Docs, activation matrix, release evidence (Swarm O) | | Not started |

Also live: the private **Secret Drop** page
(https://claude.ai/code/artifact/1f7c6ffb-f3f3-456e-8ebb-623f5124782c) for
passing API keys as ciphertext (`docs/ops/secrets.md`).

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

1. Clone, `npm ci`, `node scripts/secrets/autofill.mjs`, then apply any
   Secret Drop envelopes (`docs/ops/secrets.md`). Chromium for Playwright is
   at `PW_CHROMIUM_PATH` when preinstalled; never run `playwright install` in
   the cloud sandbox.
2. Level 03: done. `claude/wedding-03-foundation` is rebased onto `main`
   (head `3f5baee`), hardened per §6, verified, self-reviewed, and open as
   PR #4 against `main`. Once #4 is squash-merged, rebase level 04 with
   `git rebase --onto origin/main 3f5baee`.
3. Swarms: create a worktree per branch (`git worktree add ../wedding-<X>
   swarm/<X>-…`, symlink `node_modules`), give the agent
   `docs/sdlc/swarms/README.md` + its brief, its own `PORT`, and the contract
   updates in §7. Partially built swarms resume from their pushed branch;
   uncommitted work in B and D exists only in the original container.
4. Integrate in ladder order 04 → 14: `git rebase --onto <previous level>
   $(git merge-base swarm/<X>-… claude/wedding-03-foundation) swarm/<X>-…`
   (every swarm branched from `8d3ce99`; swarms that
   already rebased onto the hardened 03 head report their new base), merge into
   `claude/wedding-NN-<slug>`, `npm run verify`, `design-review` for UI
   levels, self-review file, PR against the previous level, subscribe.
5. Then swarms M/N/O (levels 15–17) on the level-14 head; final evidence in
   `docs/evidence/final-validation.md`.
6. Keep `npm run quality` green at every level; never weaken a test to pass.

## 6. Level-03 security review: what must land before PR 03

Blockers: **B1** local-storage dev route reachable in production with the
committed HMAC key (require `S3_*` or `STORAGE_SIGNING_SECRET` in production;
route 404s when `isProduction`); **B2** multipart `uploadId`/`partNumber`
unvalidated (path traversal). Should-fix: single-use confirmation tokens
(S1); idempotency keys required for action/transaction/external and
reserved before the handler (S2, S3); anonymous principals get neither (S4);
remove the client-claimed `x-capability-surface` header (S5); `explicit`
confirmation only from the UI surface (S6); same-origin JSON check on
authenticated POSTs (S7); `TRUSTED_PROXY_HOPS` for client IP (S8); stream
bodies with a cap and rate-limit before reading (S9); allowlist upload
content types and serve with `CSP: sandbox` (S10); reject sidecar/dot-segment
keys (S11); gate `/api/dev/inbox` (S12); require `DATABASE_URL` on Vercel
production (S13); housekeeping purge job (S14); HMAC the audit `inputHash`
(S15); reject future `authenticatedAt` (S16); rate-limit fail modes (S17);
S3 key validation on every method (S18); plus quick nits N1, N3–N7, N12–N14,
N16, N19. Deferred to level 15: N2, N8–N11, N15 (CSP/HSTS), N17, N18, N20,
N21. Full text lives in the integrating session's transcript; the hardening
agent's commits carry the same numbering.

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

See `docs/content/backlog.md` (18 items + 6 derived): ceremony/reception
rooms, times, room-block details, dress code, menus, palette/florals, music,
officiant, invitation count, kid policy, alternative hotels, Uber voucher
terms, registry provider, proposal story, public adventures, CAA menus, AI
rights for professional media, table assignments. Plus: Vercel project
permission, Supabase project (deferred), fal.ai/Stitch/Resend keys via Secret
Drop, Higgsfield CLI login.

## 10. Risks

Scope in one run (mitigated by contracts + serial integration); session
usage limits interrupting swarms (mitigated by frequent commits and pushed
branches); PGlite pgvector is early (fallback index exists); no ffmpeg in
the sandbox (provider seam + Playwright's bundled binary); legal gates
(BIPA, professional-media AI rights) stay OFF until counsel/vendor sign-off.
