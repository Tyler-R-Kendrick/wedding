# Environment variables

Validated once at boot by `src/lib/env.ts` (zod). Malformed values throw with the variable
name only. Every provider variable is optional; the provider falls back to its mock.
**Server** variables never reach the browser; only `NEXT_PUBLIC_*` does (`src/lib/env.public.ts`).
`next build` skips the production-required check (`NEXT_PHASE=phase-production-build`); the
running server enforces it.

## Required in production

| Variable | Used by | Notes |
|---|---|---|
| `CONFIRMATION_SECRET` | `src/policy/confirmation.ts` | HMAC key for confirmation tokens, >= 16 chars. Dev default with a warning. |
| `CRON_SECRET` | `POST /api/jobs/run` | Bearer token for the cron caller, >= 32 chars. Route returns a uniform 401 when unset or wrong. |
| `S3_BUCKET` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`, **or** `STORAGE_SIGNING_SECRET` | `src/providers/storage` | One of the two. The committed local-fs dev signing secret is never used in production: `createStorageProvider` throws and boot fails (names only). `DEV_STORAGE_SECRET` (the name the secrets autofill writes) is accepted as an alias of `STORAGE_SIGNING_SECRET`. |
| `DATABASE_URL` | `src/db/client.ts` | Required when `VERCEL_ENV=production` (boot fails without it). Vercel previews may run on ephemeral `/tmp` PGlite. Elsewhere, production without it uses PGlite on local disk. |

Also enforced at boot in production: `RATE_LIMIT_BACKEND=memory` is refused (per-process buckets are not a rate limit behind a load balancer).

## Server variables

| Variable | Default | Provider / module | Public? |
|---|---|---|---|
| `NODE_ENV` | `development` | everything | no |
| `LOG_LEVEL` | debug (dev), info (prod), silent (test) | logger | no |
| `LOG_FORMAT` | pretty in dev; `json` forces JSON | logger | no |
| `METRICS_SINK` | console (dev), db (prod), none (test) | metrics | no |
| `DATABASE_URL` | unset -> PGlite | db client (postgres-js) | no |
| `PGLITE_MEMORY` | `false` (`true` in tests) | db client | no |
| `PGLITE_DATA_DIR` | `./.data/pglite` | db client | no |
| `DB_AUTO_MIGRATE` | on outside production | db client | no |
| `DB_AUTO_SEED` | on outside production | db client (idempotent seed) | no |
| `CONFIRMATION_SECRET` | dev default (warns) | policy/confirmation; also signs admin lifecycle-preview tokens (`src/domain/lifecycle/preview.ts`) | no |
| `CRON_SECRET` | unset (route 401) | api/jobs/run | no |
| `STORAGE_SIGNING_SECRET` | dev default (warns); required in production unless S3 is configured | storage local-fs signed URLs | no |
| `DEV_STORAGE_SECRET` | unset | alias of `STORAGE_SIGNING_SECRET` (written by the secrets autofill); `STORAGE_SIGNING_SECRET` wins when both are set | no |
| `DEV_INBOX_TOKEN` | unset | bearer that unlocks `GET/DELETE /api/dev/inbox` and `POST /api/dev/identity` off a local dev server (e.g. previews with the mock mailer); without it the inbox answers only when `NODE_ENV=development` and neither `VERCEL` nor `CI` is set | no |
| `HEALTH_TOKEN` | unset | bearer that unlocks the provider/driver inventory on `/api/health` (admin principals see it without a token); `{ ok, db, time }` stays public | no |
| `AUDIT_HASH_KEY` | derived from `CONFIRMATION_SECRET` | HMAC key for the audit `inputHash` fingerprint | no |
| `TRUSTED_PROXY_HOPS` | `1` when `VERCEL` is set, else `0` | `getClientIp`: how many reverse proxies to trust for `x-forwarded-for`; `0` ignores forwarding headers entirely (all clients share the `direct` bucket) | no |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | dev default / `localhost:*` (both required in production) | auth: Better Auth (`src/lib/auth`); the URL sets the passkey relying-party id and the trusted origin | no |
| `TEST_AUTH_SECRET` | unset | `src/lib/auth/test-principal.ts`: enables `x-test-principal` injection **only** under `NODE_ENV=test`; never set on a deployed host | no |
| `ADMIN_EMAILS` | empty | auth: comma-separated allowlist granted the `owner` role; `admin_roles` rows add planner/moderator/owner | no |
| `FORCE_MOCK_PROVIDERS` | `false` | provider registry | no |
| `ANTHROPIC_API_KEY` | unset -> mock model | ai-model | no |
| `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `EMBEDDINGS_PROVIDER` (`voyage`\|`openai`) | unset -> hashed mock | embeddings | no |
| `RESEND_API_KEY`, `EMAIL_FROM` | unset -> dev inbox | auth-email | no |
| `S3_ENDPOINT`, `S3_REGION` (`auto`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (`true`) | unset -> local-fs | storage | no |
| `STORAGE_DATA_DIR` | `./.data/storage` | storage local-fs | no |
| `FLIGHTS_PROVIDER` (`mock`\|`deep-link`\|`skyscanner`\|`duffel-links`) | mock | flights: fixtures; honest unavailable + Skyscanner links; Skyscanner Live Prices; Duffel Links hosted checkout (search stays on deep links). A live mode without its key reports the missing name and keeps links working | no |
| `HOTELS_PROVIDER` (`mock`\|`deep-link`\|`booking`\|`duffel-stays`) | mock | hotels: fixtures; unavailable + Booking.com/Hyatt links; Booking.com Demand API; Duffel Stays | no |
| `SKYSCANNER_API_KEY` | unset | flights `skyscanner` mode (`x-api-key`) | no |
| `DUFFEL_API_KEY` | unset | flights `duffel-links` and hotels `duffel-stays` (bearer) | no |
| `DUFFEL_WEBHOOK_SECRET` (>= 16 chars) | unset -> `POST /travel/webhooks/duffel` answers 404 | verifies `X-Duffel-Signature`; the only automatic path to a confirmed trip item | no |
| `BOOKING_DEMAND_API_KEY`, `BOOKING_AFFILIATE_ID` | unset | hotels `booking` mode (bearer + `X-Affiliate-Id`); both required | no |
| `TRANSPORT_BENEFIT_MODE` (`mock`\|`manual-code`\|`uber`) | `mock` | transport-benefit | no |
| `TRANSPORT_MANUAL_CODES` | unset | transport-benefit manual-code: dev pool used only when no DB-backed code source is installed (the app installs one at boot, so production codes come from admin uploads in `transportation_manual_codes`) | no |
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_ORG_ID`, `UBER_VOUCHER_PROGRAM_ID` | unset -> mock | transport-benefit `uber` mode (Uber for Business Vouchers adapter); all four required, missing names reported by `validateConfig` | no |
| `UBER_API_BASE_URL` | `https://api.uber.com` | transport-benefit `uber` mode (partner sandbox override) | no |
| `TRANSPORT_SECRETS_KEY` | derived from `CONFIRMATION_SECRET` (warns) | AES-256-GCM key material (>= 32 chars) sealing unclaimed ride codes and issued redemption links at rest (`src/domain/external/vault.ts`); set a dedicated value in production | no |
| `DEV_TEST_PRINCIPALS` | `false` | dev/e2e only: installs the cookie-driven test principal resolver (`wedding-dev-principal=guest:<id>:<household>[:stale][:noclaim]` / `admin:<id>`); refused in production; replaced by the identity swarm's resolver whenever it loads | no |
| `REGISTRY_LINKS_JSON`, `CASH_FUND_LINKS_JSON` | unset -> placeholders | registry, cash-fund | no |
| `RATE_LIMIT_BACKEND` (`memory`\|`db`) | db in production, memory elsewhere | rate-limit | no |
| `JOBS_INLINE_RUNNER` | `true` | dev poller | no |
| `JOBS_POLL_INTERVAL_MS` | `2000` | dev poller | no |
| `JOBS_BATCH_SIZE` | `10` | job runner / cron route | no |
| `METRICS_RETENTION_DAYS` | `30` | `housekeeping.purge` job: delete `metrics` rows older than this | no |
| `FLAG_<NAME>` (`on`\|`off`) | `src/contracts/flags.ts` defaults | feature flags; `FLAG_DESIGN_SWITCHER=off` removes the floating design switcher from the server render | no (mirror with `NEXT_PUBLIC_FLAG_<NAME>`) |
| `FFMPEG_PATH` | `ffmpeg` on PATH, else mock | video provider (ffmpeg adapter for posters/probing; capabilities detected from the binary) | no |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_CODE` | unset -> ffmpeg/mock | video delivery via Cloudflare Stream (skeleton); all three required | no |
| `MEDIA_MAX_IMAGE_MB` | `40` | media: per-file cap for images | no |
| `MEDIA_MAX_VIDEO_MB` | `512` | media: per-file cap for videos | no |
| `MEDIA_PART_SIZE_MB` | `8` | media: multipart part size (S3/R2 require >= 5) | no |
| `MEDIA_MULTIPART_THRESHOLD_MB` | `8` | media: files above this use multipart | no |
| `NEXT_TURBOPACK_ROOT` | unset | `next.config.ts`: Turbopack filesystem root for sandboxes whose `node_modules` is a symlink outside the project (set to the parent directory). Never needed in CI or normal checkouts | no |

## Public variables (inlined into the browser bundle)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | absolute links, signed dev URLs |
| `NEXT_PUBLIC_DEFAULT_THEME` | `gilded-hour` | initial theme |
| `NEXT_PUBLIC_FLAG_<NAME>` | flag defaults | browser mirror of a feature flag |

## Tooling / tests

| Variable | Purpose |
|---|---|
| `TEST_AUTH_SECRET` | Swarm E test-only principal injection (`src/domain/testing/testPrincipal.ts`): with `NODE_ENV=test` and this secret (≥ 16 chars) in `x-test-auth`, a JSON `x-test-principal` header selects a guest/admin principal. Never honored outside `NODE_ENV=test`. |
| `SEED_TEST_FIXTURES` | `1` seeds the fictional fixture households (`src/db/seed/fixtures.ts`) at boot; only under `NODE_ENV=test`. |
| `BASE_URL` | Playwright targets this deployed URL instead of starting the app |
| `PORT` | Port Playwright starts the app on and targets when `BASE_URL` is unset (default 3000; parallel worktrees each pick one) |
| `PW_CHROMIUM_PATH` | system Chromium for sandboxes without `playwright install` (auto-detects `/opt/pw-browsers/chromium`) |
| `PW_WEB_SERVER_COMMAND` | command Playwright runs to start the app (default `npm run dev`; CI: `npm run start`) |
| `PLAYWRIGHT_BROWSERS_PATH` | where Playwright's own browsers live |
| `NODE_USE_ENV_PROXY` | make Node's HTTP client honor `HTTPS_PROXY` (needed for `npm install` behind a proxy) |
| `FAL_KEY`, `STITCH_API_KEY` | design toolchain MCP servers (unchanged) |

## Deployer checklist

1. `DATABASE_URL` (Postgres with the `vector` extension available if semantic search is wanted).
2. `CONFIRMATION_SECRET`, `CRON_SECRET` (32+ random chars each), and either the `S3_*` set or `STORAGE_SIGNING_SECRET` (boot fails with neither).
3. `NEXT_PUBLIC_SITE_URL` = the public origin; `BETTER_AUTH_URL` the same, plus `BETTER_AUTH_SECRET` (32+ random chars) and `ADMIN_EMAILS` for the couple.
4. Storage: the four `S3_*` variables (+ `S3_ENDPOINT` for R2/MinIO).
5. Email: `RESEND_API_KEY`, `EMAIL_FROM`.
6. AI: `ANTHROPIC_API_KEY`; embeddings key if semantic media search is enabled.
7. Cron: schedule `POST /api/jobs/run` every minute with the bearer token.
8. Run `npm run db:migrate` during deploy (or `DB_AUTO_MIGRATE=1` for a single instance). Do not set `DB_AUTO_SEED` in production unless you want the brief seed applied.
9. Keep `FLAG_BIOMETRICS_ENABLED` and `FLAG_PRO_MEDIA_AI_PROCESSING` off until counsel/vendor sign-off; the readiness switch is a second, persisted gate.
