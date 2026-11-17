# CI

`.github/workflows/design-quality.yml` runs on every pull request, in the merge queue, and on
`main`. `.github/workflows/stages.yml` runs when something a design stage is built from changes.

## Shape

Every job starts at once and none waits for another. One of them, `CI`, watches the rest
(`scripts/ci/gate.mjs`) and passes only when every other job has completed with success or skipped.
It is the one check to require in branch protection for this workflow.

`stages.yml` is a separate workflow that runs only when its paths change, so `CI` does not cover it
and it cannot be a required check (a required check that never starts blocks the pull request). The
stage tests themselves are in the unit job; the stage builds and the served-by-the-app probe are
only in `stages.yml`, so read its result on a pull request that touches a stage.

| Job | What it runs | Budget |
|---|---|---|
| lint · typecheck · design gates · concierge evals | `bun check`, oxlint, DESIGN.md lint, impeccable, stylelint, the docs and coverage checks, migrations, the concierge evals | 3 min |
| unit · ui · stage tests | `npm run test:unit` | 3 min |
| integration (5 shards) | `npm run test:integration`, files dealt out by recorded time | 4 min |
| e2e production (2 shards) | the `PRODUCTION_SPECS` against `next start` | 5 min |
| e2e test-server (15 shards) | the `TEST_SERVER_SPECS` against the production build started with `NODE_ENV=test` | 5 min |

The budget is the job's `timeout-minutes`. A job that outgrows it fails, so CI getting slower is a
red build. The budgets are loose on purpose (a slow runner should not fail a build); tighten them
when a job has sat well under its budget for a while.

Setup is the same in every job (`.github/actions/setup`): Node from `.nvmrc`, bun from
`.bun-version`, `bun install --frozen-lockfile`. `bun.lock` is the lockfile. Scripts still run with
`npm run`.

## Shards are filled by recorded time

- Browser tests: `scripts/ci/e2e-plan.mjs` reads `tests/e2e/durations.json` (seconds per test, per
  project) and puts the longest test into the lightest shard until none are left.
  `scripts/ci/e2e-shard.mjs <production|test-server> <i>/<n>` runs a shard. It names its tests by
  exact title, and in CI it fails if the tests the run reports are not exactly the plan's list.
- Integration tests: `scripts/ci/vitest-plan.mjs` does the same per file from
  `tests/integration/durations.json`.
- A test with no recorded time counts as the median. Record after adding slow tests, or when shard
  times drift apart: download a run's `playwright-*` and `integration-*` artifacts, then

  ```bash
  npm run e2e:durations -- path/to/*/test-results/report.json
  npm run test:durations -- path/to/integration-*.json
  ```

- A file with a serial block stays whole within a project. A file that changes something for the
  whole server names it in a `// @server-state <name>` comment; every unit with the same name gets a
  shard, and so a server, of its own.
- Changing the number of shards is one edit to the matrix in the workflow. Count the jobs first:
  this workflow has 25 and `stages.yml` 5, and at 32 running together one job waited 38 s for a
  runner, which set the time of the whole run. The plan needs at least
  as many test-server shards as there are units sharing one `@server-state` name (four today) and
  fails if it has fewer.

## Caches

- Turbopack's build cache (`.next/cache`) is saved only from `main` and restored everywhere else.
  With it a shard's `next build` takes about 12 s; without it, 30 to 60.
- Dependencies are not cached: `bun install` fetches them in about 5 s.
- The browser shards set `BUILD_SKIP_TYPECHECK=1` (`next.config.ts`), because the typecheck job
  covers what `next build` would repeat. A deploy build never sets it.
- Playwright's headless shell is cached by Playwright version.

## Selection, and the merge queue

With the repository variable `CI_SELECTION` set to `on`, a pull request skips the integration or
browser suite when none of its changed files can reach it (`scripts/ci/affected.mjs`: a list of
places those suites cannot read, such as `docs/`, root markdown and unit tests). The merge queue and
`main` always run everything.

It is off by default. Turn it on only with a merge queue that requires the `CI` check: without the
queue, nothing runs the full suite on a skipped change until after it has merged.

## Rules for tests

No test is retried. A test that fails once has a bug, in the test or in the page; find it.

1. **A browser test makes the state it reads.** In CI it can be the first test on a fresh server.
   Check with `npm run test:e2e:server -- <file>`, which runs the file alone. (The audit-trail test
   expected rows other specs had left; the seating snapshot expected an RSVP window another spec had
   opened.)
2. **Both projects share one server and run at the same moment.** Anything a test creates by name
   (a phone number, a table, an email address) is per project, or the file runs in one project. A
   project skip in `beforeEach` does not skip `beforeAll`: guard that too.
3. **A budget counted per guest is shared by every test that asks as that guest.** A test that
   drains one (the concierge rate limit) uses a guest no other test in the file uses.
4. **Server-wide settings belong to everyone.** A file that changes one (seating publication) says
   so with `// @server-state <name>`; one that only needs a value (the RSVP window open) sets it in
   `beforeAll`.
5. **Wait for the state, not for time.** Read a position after the page has stopped scrolling. Press
   a control on a pinned, animating surface at its own coordinates (`page.mouse.click`):
   `locator.click()` scrolls its target into view first, and a page that follows scroll takes that
   as the guest's.
6. **Keep serial chains short.** A serial file runs on one worker, so its length is the least a
   shard can take. A test that saves nothing does not belong in the chain.
7. **An integration test waits for what is delivered later.** `latestCode()` waits for the dev
   inbox; reading the inbox directly right after a capability returns finds it empty under load.

## Local checks

- `git push` runs `.githooks/pre-push`: oxlint and `bun check` over the repository, about 2 s.
- `git commit` runs the design gate (`.githooks/pre-commit`).
- `npm run lint` is oxlint (`.oxlintrc.json`, the former ESLint configuration rule for rule);
  `npx oxlint --format=agent` prints one finding per line. `npm run typecheck` is
  `bun check --no-script`.

## Considered, and where it stands

- **oxfmt.** Formats the repository in 0.3 s. Not adopted: there has never been a formatter here,
  and with settings chosen to match the code (single quotes, 240 columns) it would still rewrite
  881 of 1,445 source files. That is one commit that conflicts with every open branch, so it waits
  for a decision.
- **Vitest without per-file isolation.** The unit project runs in 13 s instead of 50, with 5 tests
  in 3 files failing because they rely on a fresh module graph (`auth-email-connect`,
  `dev-inbox-gate`/`dev-routes`, `phone-sign-in-availability`). Not adopted: the unit job is not
  the slowest, and those leaks need fixing first.
- **oxlint's `correctness` category.** Would add 118 jsx-a11y findings (mostly
  `prefer-tag-over-role`) and 31 others. The configuration is the former ESLint rule set; the
  category is off until someone works through them. `nextjs/no-html-link-for-pages` is off for the
  same reason: oxlint's version flags 25 plain `<a>` links that ESLint's never did, most of them
  deliberate full navigations or downloads.
- **hk.** A hook manager would replace two short scripts that together take about 2 s, and add a
  binary to install. Nothing to gain.
- **Turborepo or Nx caching, `--affected`.** Their graphs follow imports. These suites reach
  migrations, seed JSON, the built app and source read as text without importing any of it, so a
  graph would skip tests that a change can break. `scripts/ci/affected.mjs` is the conservative
  version of the same idea.
- **Bazel, Nix.** There is no container build in CI to make hermetic, and one app with four small
  workspaces does not repay either.
- **React Doctor.** Scans `src/` in 22 s: 11 errors and 400 warnings (score 57). The errors are worth
  a look (five server actions it believes set cookies without an auth check, two effects without
  cleanup, two browser globals read during render, one missing key). It is not in CI: a 22 s scan
  of everything on every push is the wrong place for it, and its findings need triage first.
- **Faster runners.** The slowest job of a run is usually one that landed on a slower GitHub runner,
  where every step before the tests takes about twice as long. Runners with more cores and steadier
  disks are the remaining lever; they need an account.
