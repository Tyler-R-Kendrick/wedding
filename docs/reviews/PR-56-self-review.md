# Self-review of PR 56 and its stack (#59–#63)

| Field | Value |
|---|---|
| PRs | #56 admin code from the guest form · #59 suppressed-send log · #60 CI Playwright queue · #61 `npm run clean` · #62 `npm run test:e2e:server` · #63 media sweep without an object store |
| Base | `main` (`7011dca`, merged into #56) |
| Reviewer | a review agent reading the committed diff `origin/main...claude/zen-noether-lgj00d-media-sweep` only, not the builder |
| Date | 2026-09-27 |
| Commands run | `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` (891), `npm run test:integration` (326), `npm run quality`, `npm run docs:check`, `npm run test:e2e:server -- tests/e2e/claim.spec.ts tests/security/otp.spec.ts` (24/24, three projects), all on the top of the stack |

The stack started from one report: a sign-in code that "never arrived". Production logs showed the
send was suppressed, not failed: the address was typed into the guest form, which only mails
guests. #56 fixes that. #59–#63 fix everything the investigation ran into on the way, so nothing is
left as follow-up.

## 1. Hostile-reviewer pass

No blocker. Five "should" and five nits, all fixed; one design suggestion declined with its reason. Finding 11 came from CI, not the diff.
Every fix sits in the PR whose code it changes.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `test:e2e:server` gave the server the developer's environment, and `next dev` loads `.env` under `NODE_ENV=test` too. A `.env` `DATABASE_URL` wins over `PGLITE_MEMORY`, so the fixture seed would write test guests and an owner admin into the couple's real Postgres; `RESEND_*`/`S3_*` would send real mail and write real objects. | should | Fixed in #62: every credential `.env.example` documents, plus the Postgres aliases, is set to `''` (Next never lets `.env` override a variable already set; the server reads `''` as unset). A throwaway `.env` pointing at a closed Postgres port proved both sides: without it the server reports `db: down`, with it the admin journey passes on PGlite. A unit test keeps new credentials covered and the alias list equal to the server's. |
| 2 | The readiness check accepted any server already answering on `PORT`; a server that exited was waited on for three minutes. | should | Fixed in #62: a port that already answers is refused; an exit fails in seconds and prints the end of the server log (which is how it surfaced Next refusing a second dev server in the checkout). |
| 3 | `file:line` filters and directories went to Playwright as pass-through options, so the run warmed every route (~14 GB) and ran every spec. | should | Fixed in #62: they are spec targets; directories expand to their spec files for the warm-up. Unit-tested. |
| 4 | stdout and stderr had separate descriptors on one log (`w` and `a`), so each could overwrite the other. | nit | Fixed in #62: one descriptor for both. The log also moved to the OS temp directory, because Playwright empties `test-results/` when it starts (found running it). |
| 5 | `clean` counted a zombie (exited, not yet reaped) as running, waited 15 s and reported SIGKILLs that never happened. | nit | Fixed in #61: `parseStat` reads the state; `Z` is gone. Unit-tested with a name containing parentheses. `test:e2e:server` uses the same check. |
| 6 | Ctrl-C during `spawnSync` ran the SIGINT handler only after Playwright exited, racing the `finally` that stops the server; spawn errors were unhandled. | should | Fixed in #62: Playwright runs async, SIGINT only sets a flag, the server is stopped once in `finally`. Verified by interrupting a run: Playwright stopped, the runner exited, no server left. |
| 7 | The new claim-journey test signs in the shared `admin@example.test` beside `invitation.spec`, so parallel workers could supersede each other's codes. | — | Not a defect: `/api/dev/identity` gives every call its own random suffix, so each test has its own `admin+<suffix>@example.test`. |
| 8 | Altitude: wrap one caller in a lazy proxy, or make the storage factory return an "unconfigured" provider instead of throwing? | suggestion | Declined. Throwing at construction is deliberate (`src/providers/storage/index.ts`: booting quietly without storage was "the worst shape a storage misconfiguration can take"). Guest-facing media capabilities surface it through the pipeline as an error, not a 500 (no runtime errors in three days of production logs), and the media-AI scan and cluster jobs never build storage. The sweep was the only thing failing on its own schedule with nothing to do. |
| 9 | `lazyProvider` trapped only `get`: awaiting it read `.then` and built the provider (throwing the error it exists to defer); `in` and `instanceof` saw an empty object; each read made a new bound function. | nit | Fixed in #63: `then` is `undefined` without building; `has` and `getPrototypeOf` forward; one bound function per method. Unit-tested. |
| 10 | The scripts' main-module guard compared `pathToFileURL(argv[1])` with `import.meta.url`; Node resolves symlinks in the latter only, so from a symlinked checkout `clean` did nothing and exited 0. | nit | Fixed in #61 and #62: real paths are compared. Checked by running `clean` through a symlink. |
| 11 | Not from the diff: #62's first CI run on the merged head failed `quality-sweep` ("/rsvp @ conservatory renders no conservatory element inside <main>") and flaked `rsvp.spec` ("Your Weekend is taking a moment"), the same pair that failed on `main` in #58's run. Every spec acts as the fixture guest A1 from every context it opens, and the pipeline meters a principal at 60 calls, 1/s: a local run logged `rate_limited` from `get_my_rsvp` 21 times, and `FriendlyFailure` rendered it. | should | Fixed in #62: the test principal resolver records what it injects (on `globalThis`, since Next bundles it twice), and those principals are metered per session; `contextAs` gives each browser context its own, API calls use the running test's. Real principals keep one bucket per person. The failing specs went from 2–3 failures a run to 98/98 with no `rate_limited`, and eleven specs using A1, `claim` and `otp` passed 250/250. |

Checked and found correct: #56 sends the admin code only when no guest matches and the address is
an administrator, keeps the response identical for every address, and still holds it to the timing
floor; #59 logs the purpose only, never the address; #60 leaves the workflow-level group (one run
per ref, superseded PR pushes cancelled, `main` never cancelled) as the only one; #61 never
matches its own ancestors, and a shell whose command merely mentions `next-server` is left alone.

## 2. Authorization table

| Route / action | Capability | Server-side check | Result |
|---|---|---|---|
| `/sign-in` (guest form) | `request_otp` `sign_in` | guest match first; else `resolveAdminRoles` (table + `ADMIN_EMAILS`) issues an `admin_sign_in` challenge | better (an admin gets a code) |
| `/claim/verify` | `verify_otp` | `isAdmin` from the verified user's email; an admin with no guest goes to `/admin` | OK (unchanged) |
| every other address | `request_otp` | suppressed, same response, now logged without the address | OK |

No new route or capability.

## 3. Secrets and PII

No secret is read or added. The test runner's placeholders are named `local-…-not-real`; its whole
point is that a local `.env` never reaches the test server. The new log line carries the purpose, not
the address. Fixtures use `example.test`.
