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

`npm install` also runs `prepare`, which points git at `.githooks/` (`git config core.hooksPath
.githooks`). From then on every commit runs the design gate in `scripts/precommit.mjs` over the
staged files only: Google's `design.md lint` on any staged DESIGN.md (read from the index; errors
and WCAG contrast warnings block), `design:sync --check` when tokens or generated theme CSS change,
`impeccable detect` on staged UI files (all of `src/` when DESIGN.md or `.impeccable/config.json`
changes, plus any staged UI files outside it; a size, colour or radius off the DESIGN.md scale blocks
as well as an anti-pattern, via `scripts/check-design-drift.mjs`), and stylelint on staged CSS. A commit that touches
no UI adds nothing. `npm run precommit` runs it by hand. A finding is fixed, or waived through
`impeccable hooks ignore-value … --reason`; `--no-verify` is not a way to land UI work, and CI runs
every check on the pull request regardless.

The installer never displaces hooks you already rely on. It does nothing under `CI`, outside a git
work tree, when `core.hooksPath` is already set at any scope (a global secret scanner, say), or when
`.git/hooks` holds real hooks (git-lfs). To opt a clone out for good, including against the Claude
SessionStart hook that re-runs the installer: `git config hooks.designGate false && git config
--unset core.hooksPath`.

Node's HTTP client ignores `HTTPS_PROXY`; behind a proxy (this sandbox, some CI) export
`NODE_USE_ENV_PROXY=1` before `npm install` so postinstall downloads succeed.

## What runs where

| Thing | Local | Production |
|---|---|---|
| Database | PGlite `./.data/pglite` (`npm run db:migrate` / `db:seed` also work) | Postgres (`DATABASE_URL`); run `npm run db:migrate` in the deploy step or set `DB_AUTO_MIGRATE=1` on a single instance |
| Storage | local-fs under `./.data/storage` (objects, `meta/` sidecars, `multipart/`); signed URLs at `/api/dev/storage/<key>?op=...&exp=...&sig=...` (never served in production) | S3-compatible bucket (or local-fs with an explicit `STORAGE_SIGNING_SECRET`) |
| OTP emails | dev inbox: `GET /api/dev/inbox` (JSON, newest first), `DELETE /api/dev/inbox` to clear. Answers only on a local `NODE_ENV=development` server (not on Vercel/CI) unless `Authorization: Bearer $DEV_INBOX_TOKEN` is sent | Resend |
| Jobs | in-process poller (`JOBS_INLINE_RUNNER=true`, every `JOBS_POLL_INTERVAL_MS`) or `npm run jobs:run` for one batch | cron hitting `POST /api/jobs/run` with `Authorization: Bearer $CRON_SECRET` |
| AI model | `ai/test` mock (`MOCK_REPLY`) | Anthropic via `ANTHROPIC_API_KEY` |
| Logs | pretty (pino-pretty); `LOG_FORMAT=json` to switch | JSON |
| Metrics | console at debug level | `metrics` table |

Health: `curl -s localhost:3000/api/health | jq` shows `{ ok, db, time }`. Add
`-H "Authorization: Bearer $HEALTH_TOKEN"` (or be signed in as an admin) to also see the db
driver, whether pgvector loaded, lifecycle state, and the mode of every provider.

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

## The rendered design scan

The source scans read CSS and JSX and cannot see a layout. `npm run slop:detect:rendered` runs
impeccable against the live pages: every public route in all three designs at 390, 820, 1280 and
1440px. It uses `BASE_URL` (default `http://localhost:3000`). To cover the guest routes too, which
otherwise show their sign-in gate, start the server the way the e2e suite does and pass the same
secret:

```bash
NODE_ENV=test TEST_AUTH_SECRET=e2e-test-secret-0123456789 SEED_TEST_FIXTURES=1 \
  NEXT_PUBLIC_SITE_URL=http://localhost:3100 PGLITE_MEMORY=1 npm run dev -- -p 3100
BASE_URL=http://localhost:3100 TEST_AUTH_SECRET=e2e-test-secret-0123456789 npm run slop:detect:rendered
```

Narrow it with `--viewports 390x844`, `--themes conservatory`, or route arguments (`-- /gifts`).
It finds Playwright's Chromium itself (set `IMPECCABLE_BROWSER` to override) and adds
`--no-sandbox` when it runs as root.

