# Local development

```bash
nvm use                 # Node 22
npm install             # or npm ci
cp .env.example .env    # optional: everything runs with no variables set
npm run dev             # http://localhost:3000
```

On first request the app connects to PGlite (embedded Postgres) in `./.data/pglite`,
applies `src/db/migrations`, and runs the idempotent seed (site row, lifecycle `TEASER`,
readiness rows, provenance sources from the brief). `PGLITE_MEMORY=1` uses a throwaway
in-memory database instead; `DATABASE_URL` switches to a real Postgres.

Node's HTTP client ignores `HTTPS_PROXY`; behind a proxy (this sandbox, some CI) export
`NODE_USE_ENV_PROXY=1` before `npm install` so postinstall downloads succeed.

## What runs where

| Thing | Local | Production |
|---|---|---|
| Database | PGlite `./.data/pglite` (`npm run db:migrate` / `db:seed` also work) | Postgres (`DATABASE_URL`); run `npm run db:migrate` in the deploy step or set `DB_AUTO_MIGRATE=1` on a single instance |
| Storage | local-fs under `./.data/storage`; signed URLs at `/api/dev/storage/<key>?op=...&exp=...&sig=...` | S3-compatible bucket |
| OTP emails | dev inbox: `GET /api/dev/inbox` (JSON, newest first), `DELETE /api/dev/inbox` to clear | Resend |
| Jobs | in-process poller (`JOBS_INLINE_RUNNER=true`, every `JOBS_POLL_INTERVAL_MS`) or `npm run jobs:run` for one batch | cron hitting `POST /api/jobs/run` with `Authorization: Bearer $CRON_SECRET` |
| AI model | `ai/test` mock (`MOCK_REPLY`) | Anthropic via `ANTHROPIC_API_KEY` |
| Logs | pretty (pino-pretty); `LOG_FORMAT=json` to switch | JSON |
| Metrics | console at debug level | `metrics` table |

Health: `curl -s localhost:3000/api/health | jq` shows db driver, whether pgvector loaded,
lifecycle state, and the mode of every provider.

Try a capability:

```bash
curl -s localhost:3000/api/capabilities/site_status -H 'content-type: application/json' -d '{"input":{}}' | jq
curl -s localhost:3000/api/capabilities/navigate_to -H 'content-type: application/json' -d '{"input":{"route":"/travel"}}' | jq
```

## Tests

```bash
npm run test:unit          # vitest: tests/unit (node) + tests/ui (jsdom + React)
npm run test:integration   # vitest against an in-memory PGlite per test file (migrations + seed)
npm run test:e2e           # Playwright smoke (tests/e2e); starts `npm run dev` unless BASE_URL is set
npm run test:a11y          # axe-core WCAG 2.2 AA over ROUTES in tests/a11y.spec.ts
npm run check              # typecheck + lint + unit
npm run verify             # everything CI runs except e2e
```

- Vitest projects: `unit`, `integration` (setup in `tests/integration/setup.ts`), `ui`.
  `@/*` maps to `src/*`; `server-only` is stubbed.
- Playwright uses Chromium for the phone/tablet/desktop projects. In sandboxes without
  `playwright install`, set `PW_CHROMIUM_PATH` (this sandbox: `/opt/pw-browsers/chromium`,
  detected automatically). `PW_WEB_SERVER_COMMAND="npm run start"` tests a production build
  (then `CONFIRMATION_SECRET`, `CRON_SECRET`, `DB_AUTO_MIGRATE=1`, `DB_AUTO_SEED=1` are needed).
- Reset local state: `rm -rf .data`.

## Adding things (feature swarms)

- Schema: new file in `src/db/schema/`, export it from `schema/index.ts`, `npm run db:generate`, commit the migration. CI fails on drift.
- Capability: `src/capabilities/<feature>/*.ts` + one import line in `src/capabilities/index.ts`.
- Job handler: `registerJobHandler('feature.task', handler)` from a module that the app imports.
- Route: `src/capabilities/routes.ts` for `navigate_to`, `src/app/<route>/page.tsx` for the page.
- Dependencies are frozen at this level; ask the foundation owner before adding a package.
