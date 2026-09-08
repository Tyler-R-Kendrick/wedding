# PR 16 — level 13: WebMCP

**Branch** `claude/wedding-13-webmcp` · **Base** `main` @ `c04993d` (level 12)
**Diff** 29 files, +3,080 / −3

A browser that exposes `document.modelContext` gets the guest's own capability set as tools,
derived from the registry rather than hand-listed. A browser that does not is completely
unaffected — nothing registers, nothing is fetched, no error. Behind the `WEBMCP` flag.

## 1. What a hostile reviewer would say

**"You are shipping an agent-facing authorization surface on a wedding website."** Fair, and it is
the reason this level got an independent adversarial security review of the *integrated* result on
top of swarm K's own. The mitigation is that the bridge adds no authorization logic: it is a
projection of the registry, and every call goes through the same `invoke` pipeline the website uses,
which re-authorizes from scratch. The parts that are genuinely new — the manifest's shape, the
uniform "not available" answer, the surface being set server-side — are all *narrowing*.

**"You changed the confirmation rule you changed last level, in the opposite direction."** True, and
this is the most important thing in the diff. Level 12 made `confirmation: 'inline'` website-only
for `action`/`transaction`. That closed a real hole — and it silently made `agentConfirmable`, the
contract's own documented opt-out, dead API: the WebMCP layer offered an escape the pipeline then
refused anyway. A flag that cannot do what its documentation says is worse than no flag, because the
next author will believe it. So the pipeline now honours it. **It is not a relaxation of level 12's
fix**: the default is unchanged and still refused, the opt-out cannot touch `explicit`, the WebMCP
layer keeps its own upgrade over the top, and nothing that ships sets it — only the test fixtures,
behind the test gate. Both directions are asserted in `tests/unit/invoke.test.ts`.

**"Two files you copied were the ones you had just changed."** They would have been, and the survey
is what stopped it. `src/lib/request.ts` and `tests/unit/crypto.test.ts` read as "K-only" against the
level-12 head — because a file present at the level-03 base and untouched since does not appear in
main's diff and so looks new. That is exactly the landmine level 12 hit with
`src/providers/ai-model/index.ts`. Re-running the survey against **merged** main moved both into the
overlapping set, where they belong; the only difference in `request.ts` turned out to be a comment,
because I had already ported K's fix verbatim at level 12.

## 2. Authorization

Nothing is granted here. The manifest lists what the *current principal* may already call, and every
execution re-authorizes:

| Concern | Where | Covered by |
|---|---|---|
| Surface cannot be claimed by a caller | route sets `surface: 'webmcp'` server-side | `tests/e2e/webmcp.spec.ts` "the surface is set server-side; no header, body field or token can claim one" |
| A tool the principal may not call is neither listed nor executable | `visibleTo` + `invoke`'s own `authorize` | e2e "a tool the principal is not authorized for is neither listed nor executable" |
| The registry cannot be enumerated by name | uniform `not_found` in `src/webmcp/server/invoke.ts:32` | e2e "unknown tools do not leak the registry" |
| A confirmation cannot be redeemed off the website | `REDEEMABLE_SURFACE = 'ui'` + the WebMCP upgrade | e2e "an explicit-confirmation capability always answers requires_ui, after step-up" |
| Cross-origin and forged-origin calls | `assertSameOriginFetch` (stricter than the UI route's) | e2e "refuses cross-origin JSON, missing origin metadata, and non-JSON bodies" |
| A forged test-auth secret | canonical resolver, constant-time compare | e2e "a forged test-auth secret is ignored and the caller stays anonymous" |

42 capabilities carry `webmcp: true`. Not one is `auth: 'admin'` reachable by a guest, and the
admin case is asserted directly.

## 3. Secrets and PII

No new secret, no new env var. The one env change is *removing* reach: `NODE_ENV=test` alongside a
deploy marker now refuses to boot, because that combination opens the test-principal gate and turns
two headers into any guest or admin. Personalized manifests are `no-store` (asserted). Error bodies
are uniform and carry no registry detail.

## 4. Tests

**Added:** 6 unit files under `tests/unit/webmcp/` and `tests/e2e/webmcp.spec.ts` (33 tests across
three viewport projects).

**The e2e spec's authenticated cases had `test.skip(!TEST_AUTH_SECRET)`** — the level-06 defect
exactly: three security suites skipped there and reported green, which is why
`scripts/check-spec-coverage.mjs` exists at all. The guards are deleted and the spec is registered
in the test-server arrangement, which sets the secret. All 33 run; before, the ones that matter most
(authorization, step-up, forged secrets) would have skipped.

**Three assertions changed deliberately**, each because it pinned a number or a pairing rather than
its guarantee:

1. `tests/unit/webmcp/derivation.test.ts` hardcoded `2_000` for `site_status`'s output cap — its
   value on swarm K's level-03 base. A later level tuned it to 4,000 and the test failed for a
   reason unrelated to the derivation it exists to check. It now reads the descriptor.
2. `tests/unit/env.test.ts` used `NODE_ENV=test` with `VERCEL` to exercise the hop default — the
   combination the new guard makes impossible by design. It uses `development` for those cases; the
   subject is the hop arithmetic, not the environment name.
3. `tests/unit/webmcp/bridge-hardening.test.ts`'s `agentConfirmable` case: unchanged in what it
   asserts, but it only passes because the pipeline now honours the flag (see §1).

**Deleted:** `tests/unit/webmcp/test-principal.test.ts`, with the resolver it tested. Five of its six
cases duplicate `tests/unit/test-principal-gate.test.ts`. The sixth was genuinely unique and is
ported: that a stale principal and a fresh one are both expressible. **Nothing on main covered
that**, and it matters — if `authenticatedAt` were dropped and defaulted to "now", every principal
would be fresh and every step-up test would pass without exercising the gate.

## 5. Threat model

Swarm K's own adversarial review (`/home/user/wedding-K/review-K/findings.md`, 8 findings, no
blockers) was written against a level-03 base. Re-checked against the shipped code:

| K's finding | State |
|---|---|
| 1. `inline` evaporates on the agent surface | **Closed at the pipeline** (level 12), plus K's own upgrade. Found independently from the concierge side |
| 2. Registry probeable by name | Fixed in K's code; uniform `not_found` verified at `src/webmcp/server/invoke.ts:32,54,61` |
| 3. Rate-limit bucket chosen by the caller | **Ported into level 12** — it applied to `/api/ai/chat` first. The counterpart warning (`TRUSTED_PROXY_HOPS=0` shares one bucket) lands here |
| 4. AbortSignal ignored | Fixed in K's code (`register.client.ts` per-generation controllers) |
| 5. Test escape hatch escapes WebMCP | Now gated on the canonical `isTestPrincipalEnabled()`; the fixtures live in their own registry and are never written into the process-wide one |
| 6. Untrusted-content warning dropped on the draft path | Fixed in K's code |
| 7. Idempotency keys accept any 8-char string | Fixed: `ID_PATTERN` (ULID) at `handlers.ts:33` |
| 8. Sign-out leaves tools registered | Fixed: manifest fingerprint + per-generation abort |

### The independent review of the integrated result

**Verdict: no blockers, 4 should-fix, 5 nits.** It went for the two deltas I flagged as highest-risk
and found something real in one of them.

| # | Finding | Resolution |
|---|---|---|
| **S1** | `agentConfirmable` disarmed the `inline` refusal for a **transaction**, not just an action — the contract field's own doc comment says it "never relaxes `explicit`, `transaction` or `external`", and the code I wrote three lines under that comment did not honour it | **Fixed.** `agentMayComplete` now requires `kind === 'action'`. On `webmcp` it was masked by `effectiveWebMcpDescriptor`'s re-upgrade; on `ai` there is no second belt, so a `transaction` + `inline` + `agentConfirmable` descriptor would have committed unattended. Asserted in `tests/unit/invoke.test.ts` |
| **S2** | The WebMCP route metered anonymous callers only, and its context carried no client | **Fixed** in `src/webmcp/server/handlers.ts`: `rateLimit: principal.kind !== 'anonymous'` and `clientIp` in the context, matching the JSON route |
| **S3** | `/api/ai/chat` consumed the `concierge` policy but `ask_concierge` invoked from any other door did not — one budget, one door paying | **Fixed in the capability, not the route**: the handler consumes `concierge` itself, keyed `ai:anon:<ip>` / `ai:<principal>` exactly as the chat route does, so every door pays |
| **S4** | Nothing stopped a capability being `ai: true, webmcp: false` — an asymmetry no descriptor should have silently | **Guarded** in `tests/unit/webmcp/derivation.test.ts` |
| **N1** | Two `src/lib/env.ts` guards from swarm K were not ported | **Ported**: `NODE_ENV=test` on a deployed app refuses to boot; `TRUSTED_PROXY_HOPS=0` in production warns |
| **N2** | Idempotency scope is not surface-scoped, so a `ui` result could replay onto `ai`/`webmcp` past the agent output cap | **Fixed, but not the way it was proposed.** Surface-scoping the *key* would let one key run the handler once per surface, which is the opposite of what an idempotency key promises. The cap belongs to the surface receiving the answer, so it is applied on the way out and the replay return is capped too. `tests/unit/invoke.test.ts` covers both halves: oversized is refused on `ai` and `webmcp`, and a replay that fits still replays |
| **N3** | `state()` reports unregistered tools | **Fixed.** A generation aborted mid-`registerTool` resumed, pushed the rest onto its local list and assigned it back — republishing tools `stop()` had just unregistered, and restoring a fingerprint it had cleared, which the next `refresh` would then short-circuit on. `tests/unit/webmcp/register-client.test.ts` |
| **N4** | An admin's manifest advertises guest tools | **Not fixed here; owned by level 15**, with the reason. The cause is `meetsAuthLevel('guest', admin) === true` in `src/policy/entitlements.ts` — a foundation-wide policy from level 03 that every surface shares, not a WebMCP one. Patching only the manifest would make it disagree with `visibleTo`, which is precisely the divergence the readiness comment in `src/webmcp/server/invoke.ts` warns about ("the two lists have to agree or the mask leaks what the manifest hides"). The real fix needs a contract distinction between "a guest may" and "a guest identity is required", which is a policy change deserving its own review. It fails closed today: those handlers call `guestOf()` and refuse |
| **N5** | Input validation precedes the confirmation refusal, so an agent is told to fix input for a call that could never complete on its surface | **Not taken, deliberately.** Hoisting the refusal above step 2 also hoists it above `authorize` (step 3), which would tell an *unauthorized* caller that the capability exists and needs UI confirmation — trading a wasted round-trip for an existence leak. Doing it properly means moving input validation below authorization, a reordering of the security pipeline that belongs to level 15 with its own review, not to the end of this one |

**Both N2 and N3 were mutation-verified**: each new test was run against the code it replaces and
watched to fail first (`ai must not receive the oversized stored result: expected true to be false`;
`expected [ 'first', 'second' ] to deeply equal []`).

### The defect the review did not find, and neither did I until a test broke

Wiring `clientIp` into the capability route's context (S2's counterpart on the JSON door) turned
`tests/security/otp.spec.ts:51` red — it expected a 429 and got a 200. It was mine, and chasing it
found something worse than the test failure.

`ipHashOf(ctx)` is `hashOtpIdentifier(transportOf(ctx).clientIp ?? 'unknown')`. **The JSON capability
route never set `clientIp`**, so every caller through that door hashed to `'unknown'` and shared one
bucket. `OTP_LIMITS.sendPerEmailIp` — the tight capacity-5 bucket whose own comment says it exists so
"a stranger cannot exhaust a guest's own allowance (review S10)" — had no client dimension at all
there. A stranger *could* exhaust a guest's allowance for their own address, which is the exact thing
it was added to prevent.

The test passed for six levels because of that collapse: `cap()` in `tests/security/helpers.ts` sends
a **fresh random `x-forwarded-for` per call** (level 06, so the coarse per-IP route bucket does not
trip mid-spec), and with the client discarded server-side all seven sends landed in one bucket.
With the client honoured they land in seven, and none reaches capacity.

The test is not weakened to accommodate this. `cap()` gained an opt-in `client` so a spec can hold
one address, this test holds one — which is the scenario a capacity-5 per-(email, client) bucket
actually defends — and it gained the assertion that is only now meaningful: **a second client is not
locked out by the first client's exhaustion.** Mutation-verified against the pre-fix route:
`Expected: 200, Received: 429`, because every caller shared one bucket.

## 6. Design verdict

No new guest-facing UI. `WebMcpBridge` renders `null`; the only DOM change is that a supporting
browser gets tools registered. The e2e spec asserts a non-supporting browser "loads with zero
errors, registers nothing, and never calls the bridge". No design review round: there is nothing to
look at.

## 7. Accessibility and performance

Nothing renders, so nothing to make accessible. The bridge is a client island that fetches one
manifest per principal change and re-registers on client-side navigation; the manifest has its own
rate-limit bucket rather than sharing the capability route's 60-token one, so ordinary
wedding-weekend traffic cannot 429 the website for everyone.

## 8. Docs

`docs/architecture/webmcp.md` lands with the code. The contract addition is documented on the field
itself in `src/contracts/capability.ts`, including its interaction with level 12's rule.

## 9. `TODO(Tyler & Sara)` inventory

**124 in `src/`** — unchanged by this level, which renders nothing and authors no content. That is
the number that matters: it is what a guest could see and what the couple still have to decide. The
`docs/` count (226) is self-referential and not a useful measure — it counts every review, critique
and prototype that *discusses* the marker, including this file.

*Correction to PR 15.* Its §9 gave the total as "215 markers ... 124 in `src/` ... 127 in `docs/`".
The two components were right; the total is 251, not 215. Nothing followed from the figure, but it
was wrong in a document whose point is that its numbers can be trusted.

## 10. Verdict

**Ready to merge.** The independent review reported no blockers; all four should-fixes and three of
the five nits are closed, and the two that are not are named above with the level that owns them and
why they are not this level's to make.

`npm run verify` exit 0 — typecheck, eslint (0 errors, 7 pre-existing `<img>` warnings from levels
10–11), stylelint, three DESIGN.md files at 0 errors, design sync, `impeccable detect .`, 595
unit/UI, 262 integration, evals, `next build`. Both Playwright arrangements green on servers this run
started: **229 passed / 86 skipped** production, **149 passed / 46 skipped** test-server (the skips
are the deliberate single-project guards). `check-spec-coverage` and `check-vitest-coverage` pass.
`db:generate` reports no drift.

**The worst true thing about this diff** is not in the WebMCP code at all. It is that a rate limit
whose comment named the attack it prevented had been inoperative on the site's main JSON door since
level 06, and the security suite written to cover it was green the whole time — because the test and
the defect shared an assumption. Two levels of adversarial review, mine included, read that code and
did not see it; a test failure caused by an unrelated fix did. The lesson is the one this run keeps
relearning in new costumes: a passing security test proves the assertion holds, not that the
guarantee does.
