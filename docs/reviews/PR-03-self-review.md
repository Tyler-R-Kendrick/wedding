# Self-review — PR 03 `foundation`

| Field | Value |
|---|---|
| Branch | `claude/wedding-03-foundation` |
| Base | `main` (levels 01, 02 and `plan.md` squash-merged as #1, #2, #3) |
| Reviewer | integrator (parent agent) over the foundation build, then a separate adversarial security pass (findings B1–B2, S1–S18, N1–N21) and a hardening pass that fixed everything not explicitly deferred |
| Date | 2026-09-05 |
| Commands run | `npm run verify` (typecheck, eslint, unit, stylelint, design lint ×3, detector, integration on PGlite, `next build`), `BASE_URL=http://localhost:3103 npm run test:e2e`, secrets grep, TODO inventory, `git diff --stat origin/main` |

## 1. Hostile-reviewer pass

Ranked conceptual → structural → security → polish. Everything marked
*fixed* references a commit on this branch; *deferred* items carry their
target level and are repeated in `plan.md` §6.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | "24k lines and still no page a guest can use." True by design: level 03 is the contract layer every swarm codes against (`src/contracts`, capability pipeline, providers, DB, jobs, CI). The first guest-facing pages are level 04, already built in a worktree against these contracts. | should | Accepted; ADR-0010 ladder |
| 2 | Only two capabilities exist (`site_status`, `navigate_to`). Is the nine-step pipeline over-engineered for that? | should | The pipeline is exercised by 12 unit tests with synthetic descriptors covering every branch (draft/confirm, idempotent replay, anonymous refusals, output cap, audit failure). Swarms add the real capabilities without touching `invoke.ts`. |
| 3 | **B1** Local-storage dev route was reachable in production with the committed HMAC default key. | blocker | fixed `8741ea1`: production requires `S3_*` or `STORAGE_SIGNING_SECRET`; `/api/dev/storage` 404s when `isProduction`; tests in `env.test.ts`, `dev-routes.test.ts` |
| 4 | **B2** Multipart `uploadId` / `partNumber` were unvalidated (path traversal into the storage root). | blocker | fixed `6d95e7b`: strict id patterns, `isValidKey` on every method, hashed sidecars, dot-segment rejection; `providers.test.ts` |
| 5 | **S1/S6/S19** Confirmation tokens were replayable and redeemable from the AI/WebMCP surfaces. | should | fixed `601fde5`: token carries the issuing surface, only `ui` is redeemable, the nonce is reserved single-use in the idempotency store (after the replay check so an honest retry replays instead of burning a second confirmation) |
| 6 | **S2/S3/S4** Idempotency was optional, checked-then-set (race), and shared by every anonymous caller. | should | fixed `f8893b3`, `ac5d908`: mandatory key + store for `action`/`transaction`/`external`; `reserve()` before the handler with `release()` on failure; anonymous principals get neither keys nor explicit confirmation |
| 7 | **S5/S7/S9** The route trusted a client-claimed `x-capability-surface` header, had no CSRF check, and read the whole body before rate-limiting. | should | fixed `1a6b6c8`: header removed (surface is always `ui` over HTTP), `assertSameOriginJson`, limiter runs first, body streamed with a byte cap |
| 8 | **S8** Client IP came from `x-forwarded-for` without knowing how many proxies to trust. | should | fixed: `TRUSTED_PROXY_HOPS` (default 1 on Vercel, 0 elsewhere; 0 yields `'direct'`) |
| 9 | **S10/S11/S18** Uploaded content types unbounded; sidecar keys reachable; S3 adapter skipped key validation on some methods. | should | fixed `6d95e7b`: content-type allowlist, `CSP: sandbox` on served objects, sidecars hashed, S3 guards on every method |
| 10 | **S12/S13/N5/N6** Dev inbox open; `DATABASE_URL` optional on Vercel production; cron route leaked which secret was wrong; health route listed every provider. | should | fixed `1802e13`, `8741ea1`: `DEV_INBOX_TOKEN`, `DATABASE_URL` required when `VERCEL_ENV=production`, uniform 401, inventory behind `HEALTH_TOKEN` |
| 11 | **S14** Nothing purged old audit/metrics/idempotency rows. | should | fixed `a264993`: `housekeeping.purge` job enqueued from the cron route, `METRICS_RETENTION_DAYS` |
| 12 | **S15** Audit rows stored a raw SHA-256 of the input (guessable for small inputs). | should | fixed `b40cc7a`: HMAC with `AUDIT_HASH_KEY`, omitted for `read`/`navigate` |
| 13 | **S16/S17** Step-up accepted a future `authenticatedAt`; rate limiter fail-open by default and memory backend allowed in production. | should | fixed `1c15a38`, `38062b7`: future timestamps rejected, ADR-0001 aligned to 5 minutes; per-policy `failMode`, age eviction, `RATE_LIMIT_BACKEND=memory` refused in production |
| 14 | **N1/N3/N4/N12/N13/N14/N16/N19** Maps host allowlist, IATA validation, prototype-key hashing, seed idempotence, HEAD via `storage.head()`, dev read TTL, SHA-pinned actions, token part count. | nit | fixed `bbed8b0` and the commits above |
| 15 | Deferred: **N2, N8–N11, N15 (CSP/HSTS headers), N17, N18, N20, N21.** | nit | level 15 `security` per `plan.md` §6; none is reachable from the two shipped capabilities |
| 16 | The Next.js app has no auth yet, so `admin` capabilities cannot be invoked at all. | nit | Level 06 wires Better Auth into `principalFromRequest`; until then `admin` descriptors resolve to `unauthenticated` (tested) |
| 17 | `package-lock.json` churn (13k lines) makes the diff unreviewable line-by-line. | nit | Single install for the whole stack (ADR-0010: no lockfile edits by swarms); reviewers read `package.json` |

## 2. Authorization table

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test performed | Result |
|---|---|---|---|---|
| `POST /api/capabilities/[name]` | any registered descriptor | `authorize()` (auth level + `requires` entitlements), then step-up, confirmation, idempotency | unauthenticated → `unauthenticated`; unknown name → `not_found`; surface header ignored; cross-origin JSON → 403 (`capability-route.test.ts`) | pass |
| `site_status` (read) | `site_status` / read | anonymous allowed; no personal data | n/a (public) | pass |
| `navigate_to` (navigate) | `navigate_to` / navigate | anonymous allowed; destination validated against the route allowlist (`redirects.test.ts`) | open-redirect attempts rejected | pass |
| `GET /api/health` | ops | inventory only with `HEALTH_TOKEN` (`ops-routes.test.ts`) | no token → status only | pass |
| `POST /api/jobs/run` | ops | `CRON_SECRET` (≥32 chars), uniform 401 | wrong/missing secret → identical 401 | pass |
| `GET /api/dev/inbox` | dev | 404 in production; `DEV_INBOX_TOKEN` otherwise | `dev-routes.test.ts` | pass |
| `/api/dev/storage/[...key]` | dev | 404 in production; HMAC-signed, expiring URLs; key rules | traversal, sidecar, expired-signature tests | pass |

Step-up required for any money/identity action? **n/a** — no such capability
ships at this level; the `stepUp` flag and `requireFreshSession` are tested
against synthetic descriptors (`policy.test.ts`, `invoke.test.ts`).

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_[A-Za-z0-9]{8,}|pk_[A-Za-z0-9]{8,}|BEGIN (RSA|EC|OPENSSH) PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs scripts .github
docs/sdlc/swarms/J-ai-concierge.md:8: … ask_concierge …   (false positive: "ask_" matches "sk_")
```

- [x] No guest names, emails, addresses, phone numbers, or table assignments in the repo (seed carries only brief §2 facts)
- [x] No provider keys in client bundles: every provider is constructed server-side from `env`; `.env.example` has empty values only
- [x] EXIF/GPS: no derivative is produced at this level; `LocalFsStorage` stores bytes verbatim and the served route sets `CSP: sandbox` and `nosniff`
- [x] `.env`, `.secrets/private*` never read (denied in `.claude/settings.json`)

## 4. Tests

| Area | Covered by (file) | Not covered — why / follow-up |
|---|---|---|
| Unit (94) | `contracts`, `capabilities`, `invoke`, `confirmation`, `idempotency`, `policy`, `crypto`, `env`, `providers`, `redirects`, `dev-routes` | Real S3/Resend/Anthropic adapters are exercised only against fakes (no credentials in CI) |
| Integration on PGlite (25) | `migrations`, `seed`, `site`, `audit`, `idempotency`, `jobs`, `housekeeping`, `rate-limit`, `vector`, `capability-route`, `ops-routes` | Supabase Postgres path runs the same migrations but is not in CI until a project exists |
| E2E (9, mobile/tablet/desktop) | `tests/e2e/smoke.spec.ts`: home renders names + date with axe clean, health inventory gated by the ops bearer, capability route answers `site_status` and rejects unknown names | Visual regression starts at level 04 with the theme kits |
| Evals | n/a — no model calls at this level | level 12 |
| Axe (3) | `tests/a11y.spec.ts` (WCAG 2.2 AA, three viewports) against the shell page | Real pages at level 04 |

## 5. Threat-model items touched

- [x] 0001 identity: step-up freshness (5 min, future timestamps rejected); no auth provider yet
- [x] 0002 capabilities: entitlements, single-use UI-only confirmation, mandatory reserve-first idempotency, anonymous refusals, output cap for AI/WebMCP, audit on every outcome (audit sink failure fails consequential calls)
- [ ] 0003 AI grounding: not touched (mocks only)
- [x] 0004 external transactions: `external` kind is idempotent-mandatory; redirect allowlist; maps hosts pinned
- [x] 0005 media: storage key rules, signed dev URLs, content-type allowlist, sandboxed serving; no derivatives yet
- [x] 0006 biometrics: `BIOMETRICS_ENABLED=false`, readiness-gated flags fail closed without a readiness service
- [x] 0011 provenance: `Provenance` contract, `freshnessOf`, `toCitation`; seed carries sources for every fact
- [x] 0012 lifecycle: state machine + `suggestedStateFor` (calendar day, America/Chicago); override lands with admin at level 04/14

## 6. Design verdict per theme

n/a — this level ships one unthemed shell page (`src/app/page.tsx`) that
exists so the e2e/axe harness has a target. Theme kits, recipes and the
switcher are level 04, which carries the first `design-review` scores.
`npm run design:lint` still passes for root + both theme `DESIGN.md` files
(0 errors) and `npm run slop:detect` is clean over `src/`.

## 7. Accessibility and performance

- Axe (390px, 1440px) on the shell page: 0 serious/critical.
- Keyboard walk: the shell has no interactive elements beyond links; done.
- 17px body, visible labels, focus visible, reduced-motion: inherited from the root `DESIGN.md` tokens in `globals.css`; real pages reviewed at level 04.
- `next build`: 8 routes, first-load JS is the Next.js baseline (no client components yet).
- Print check: n/a.

## 8. Docs and ADRs

- ADRs: 0001 amended (step-up 5 minutes); 0002 and 0007 referenced by `docs/architecture/capability-layer.md` and `providers.md`.
- New: `docs/architecture/{overview,capability-layer,providers}.md`, `docs/ops/{local-dev,environment}.md` (every env var incl. the six added by hardening).
- `docs/design/design-doc.md`: untouched (no UI).
- `docs/content/backlog.md`: unchanged.
- `plan.md` §6 lists the deferred nits; §7 the contract updates already sent to the swarms.

## 9. TODO inventory

```
$ grep -rn "TODO(Tyler & Sara)" src | wc -l
10
```

| File | TODO | Visible to guests? | Owner |
|---|---|---|---|
| `src/providers/registry/mock.ts` | registry link, "help us with our next adventures" link | not yet (level 09) | Tyler & Sara |
| `src/providers/hotels/deep-link.ts` | courtesy room-block link from the planner | not yet (level 08) | Tyler & Sara / Bustle & Lace |
| `src/themes/*/DESIGN.md`, `design.json` | policy sentences, not content | no | — |
| `src/db/seed/seed.ts` | comment: policy only | no | — |

## 10. Verdict

**READY.** A reviewer could reject this for size and for shipping no guest
page. It should merge anyway because every later level depends on these
contracts, the security review's two blockers and all eighteen should-fix
items are closed with tests, the remaining nits are scoped to level 15 and
unreachable from the two shipped capabilities, and the full gate (`verify`
+ e2e) is green on the rebased head.
