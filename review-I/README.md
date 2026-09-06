# review-I — adversarial security & privacy review of swarm/I-media-ai-biometric @ 7e03ee9

Read `findings.md`. Nothing in the swarm's source was modified; everything here is
proof-of-concept evidence.

## Running the proof-of-concept tests

```bash
cd /home/user/wedding-I && export -n NODE_OPTIONS
npx vitest run --config review-I/vitest.config.ts                    # all of them
npx vitest run --config review-I/vitest.config.ts review-I/f1-deletion-leaves-copies.test.ts
```

They use the same in-memory PGlite + seed setup as `tests/integration` (`review-I/vitest.config.ts`
reuses `tests/integration/setup.ts`) and the same fixtures (`tests/helpers/media-ai-fixtures.ts`).
Expected result today: **8 failing, 17 passing** — every failure is a finding, every pass is a
verified invariant.

| File | What it proves |
|---|---|
| `f1-deletion-leaves-copies.test.ts` | F1 — match results survive a completed deletion, in the public schema, and replay |
| `probes.test.ts` (3rd case) | F1b — the same for enrolment outcomes; the other two cases are verified negatives |
| `f2-superseded-consent-retention.test.ts` | F2 — a superseded consent leaves the sealed template in the vault |
| `f4-seam-match-without-subject.test.ts` | F4 — the provider seam runs 1:N identification with no consent at all |
| `f3-consent-ledger-ambiguity.test.ts` | F3 — two concurrent grants, one of them never withdrawable |
| `f5-counsel-reference.test.ts` | F5 — "asd" opens the BIPA readiness gate and is never recorded |
| `f6-pro-media-embeddings.test.ts` | F6 — unconfirmed professional media is described to an external embeddings API |
| `verified-invariants.test.ts` | 14 invariants that hold (withdrawal, surfaces, tokens, vault, search ACL) |
| `spotcheck.test.ts` | the counsel-reference schema really does reject blank/whitespace, and really does accept `asd` |

`harness.ts` is shared setup. `build.log` is the `next build --webpack` output used for the
client-bundle measurement in F-bundle (see findings.md, "Verified"); `.next/` is gitignored build
output and can be regenerated with `npx next build --webpack`.
