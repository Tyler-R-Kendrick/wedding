# Providers

Every external system sits behind a provider seam in `src/providers/<kind>/`:

```
types.ts   the interface (extends ProviderDescriptor from src/contracts/providers.ts)
mock.ts    deterministic, in-memory, fixture-driven; always available
<name>.ts  concrete adapter(s), loaded lazily
index.ts   createXProvider(env, deps): mode selection from configuration
```

`getProvider(kind, { db? })` in `src/providers/registry.ts` returns the typed instance,
caches it per process, and always resolves to the mock when nothing is configured.
`FORCE_MOCK_PROVIDERS=1` forces mocks even when keys exist. `describeProviders()` feeds
`/api/health` and the admin integrations page with `{ kind, name, mode, config }` and
never includes values. Tests replace instances with `setProviderOverride(kind, instance)`.

Fallback ladder for anything guest-facing: **API -> provider deep link -> admin-configured
URL -> honest unavailable state.** Live results are `LiveSnapshot`s with `retrievedAt` and
a TTL; they are never persisted as evergreen knowledge. Every URL returned to a guest must
pass `assertAllowedRedirect` (`src/lib/redirects.ts`).

Failures are `ProviderFailure { provider, class, message, retryAfterMs?, raw? }` inside a
`Result`; `toCapabilityError` maps them to guest-safe capability errors
(`unconfigured|timeout|network|server -> provider_unavailable`, `rate_limited`, `not_found`,
else `provider_error`). `raw` never leaves the server.

## Kinds

| kind | interface (ops) | mock | live adapter | env vars | mode when unset |
|---|---|---|---|---|---|
| `auth-email` | `sendOtp({to, code, purpose, expiresInMinutes?})` | `MockAuthEmail` stores to the dev inbox (`devInbox.list/latestFor/clear`, `GET/DELETE /api/dev/inbox`, never in production) | `ResendAuthEmail` (HTTPS API) | `RESEND_API_KEY`, `EMAIL_FROM` | mock |
| `storage` | `putObject/getObject/deleteObject/head`, `createSignedUploadUrl`, `createSignedReadUrl`, multipart `initiate/signPart/complete/abort` | `LocalFsStorage` under `STORAGE_DATA_DIR` (`./.data/storage`); signed URLs (`HMAC`, expiry) served by `/api/dev/storage/<key>` (active only while local-fs is the storage provider) | `S3Storage` (S3/R2/MinIO via `@aws-sdk/client-s3` + presigner) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `STORAGE_SIGNING_SECRET` | mock (local-fs) |
| `video` | `createAsset({objectKey})`, `getPlayback(assetId)` | `MockVideo`: instant "ready", playback = signed read URL of the original | none yet (media swarm). Keyframes/transcodes via ffmpeg belong there; read `FFMPEG_PATH` (default `ffmpeg` on PATH; this sandbox has `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`) | - | mock |
| `media-ai` | `caption(media)`, `describeScenes(media, {maxScenes})`, `tags(media, {max})` | `MockMediaAi`: deterministic from the key hash | none yet; a vision adapter must honor `PRO_MEDIA_AI_PROCESSING` | - | mock |
| `embeddings` | `embed(texts) -> {vectors, dims, model}`; `dims`, `model` | `MockEmbeddings`: hashed bag-of-words unit vectors, 256 dims | `AiSdkEmbeddings` via `embedMany` (`voyage-3.5-lite` 1024d or `text-embedding-3-small` 1536d) | `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `EMBEDDINGS_PROVIDER` | mock |
| `vector-index` | `upsert(ns, items)`, `query(ns, {vector, k, filter})`, `delete(ns, ids)`; `dims` | `InMemoryCosineIndex` (always available) | `PgVectorIndex` when `db.vectorAvailable` (creates `vector_index_items` lazily; cosine `<=>`; jsonb `@>` filter) | - (needs pgvector) | memory |
| `biometric` | `assertReady()`, `enroll`, `match`, `delete` | `MockBiometric` (in-memory vault; `delete` works even when disabled) | none; BIPA counsel review gate | `FLAG_BIOMETRICS_ENABLED` + readiness row | mock (disabled) |
| `ai-model` | `getLanguageModel('chat'\|'verifier'\|'caption')`, `modelIdFor(role)` | `MockAiModel` using `MockLanguageModelV4` from `ai/test` (replies `MOCK_REPLY`; streaming works) | `AnthropicAiModel` via `@ai-sdk/anthropic`: chat `claude-sonnet-5`, verifier/caption `claude-haiku-4-5` | `ANTHROPIC_API_KEY` | mock |
| `flights` | `search(req) -> LiveSnapshot<FlightResult[]>`, `deepLink(req)` | `MockFlights`: fixtures into ORD/MDW labelled "Mock Airways"; Skyscanner deep link | `DeepLinkOnlyFlights` (`FLIGHTS_PROVIDER=deep-link`): search unavailable, links work. Live (Duffel) is the travel swarm's | `FLIGHTS_PROVIDER`, `DUFFEL_API_KEY` (reserved) | mock |
| `hotels` | `search(req)`, `deepLink(req)`, `venueHandoff()` | `MockHotels`: venue hotel first (no rates) + "Mock Hotel" fixtures; Booking.com deep link | `DeepLinkOnlyHotels` (`HOTELS_PROVIDER=deep-link`) | `HOTELS_PROVIDER` | mock |
| `transport-benefit` | `createVoucherClaim(req)`, `getRedemptionLink({providerRef})` | `MockTransportBenefit`: idempotent per claim, fake `https://www.uber.com/redeem/MOCK-...` links | `ManualCodeTransportBenefit` (`TRANSPORT_BENEFIT_MODE=manual-code`, codes from a `ManualCodeSource`; `MemoryCodeSource` reads `TRANSPORT_MANUAL_CODES` in dev). Uber Vouchers adapter is the transport swarm's | `TRANSPORT_BENEFIT_MODE`, `TRANSPORT_MANUAL_CODES`, `UBER_CLIENT_ID/SECRET` | mock |
| `registry` | `describeLinks() -> GiftLink[]` (`{id, provider, label, url, note?, disclosure, opensNewTab}`) | `MockRegistry`: `TODO(Tyler & Sara)` placeholder on zola.com | `ConfiguredLinks` from `REGISTRY_LINKS_JSON` (validated, allowlisted) | `REGISTRY_LINKS_JSON` | mock |
| `cash-fund` | `describeLinks()` (copy: "help us with our next adventures", never "cash fund") | `MockCashFund` | `ConfiguredLinks` from `CASH_FUND_LINKS_JSON` | `CASH_FUND_LINKS_JSON` | mock |
| `reservations` | `options(place, {date?, partySize?}) -> {rung: api\|deep-link\|url\|unavailable, handoff?}` | `MockReservations`: Resy / OpenTable deep links, admin URL, else unavailable | none (API rung unimplemented) | - | deep-link |
| `maps` | `directionsUrl(place, {mode, platform, origin})`, `staticMapUrl(place)` | `DeepLinkMaps` (Google / Apple links; no API, no keys) | same class | - | deep-link |
| `rate-limit` | `consume(key, policy\|name, cost?) -> {allowed, remaining, retryAfterMs?}`, `reset(key)`; named policies in `RATE_LIMIT_POLICIES` | `MemoryRateLimit` | `DbRateLimit` (row-locked token bucket in `rate_limits`) | `RATE_LIMIT_BACKEND` (default db in production) | memory |
| `jobs` | `enqueue`, `runDue`, `counts` | - | `DbJobs` over `src/lib/jobs` (needs `{ db }`) | `JOBS_*` | live (db) |

## Adding a concrete adapter

1. Implement the interface in `src/providers/<kind>/<name>.ts`. Set `name`, `mode`
   (`live`, `sandbox`, `deep-link`), `capabilities` (what this instance can really do),
   `validateConfig()` (names of missing/malformed vars, never values) and `health()`.
2. Load SDKs lazily (`await import(...)`) so mocks stay cheap and bundles small. Honor
   `DEFAULT_CALL_POLICY` (timeouts, bounded retries, circuit breaking) with
   `AbortSignal.timeout`.
3. Classify errors into `ProviderFailure.class`; write guest-safe messages; keep `raw` server-side.
4. Select it in `index.ts` from `env` (add the variables to `src/lib/env.ts` as optional,
   to `.env.example`, and to `docs/ops/environment.md`). Unconfigured must still resolve to the mock.
5. Add unit tests with a fake `fetch`/client and, if it touches the DB, an integration test.
6. Never let a provider import domain, capabilities, or app code (lint rule).
