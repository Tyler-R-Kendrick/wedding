# PR 27 (level 17) — docs, activation matrix, release evidence

The last level. Its deliverable is not prose: it is **three checks that fail the
build**, plus the documents they now hold to the truth.

## 1. What a hostile reviewer would say

*"This is a documentation level. You wrote eight documents nobody will read and
called it engineering."*

The answer is the reason this level is shaped the way it is. Six pull requests
in this run existed for one defect class: **the site describing a version of
itself that does not exist.** A documentation level that hand-writes an
activation matrix, a variable reference and an architecture index is that same
defect with a longer half-life — the reader is an operator deciding what to
switch on in production, or an agent deciding where a file lives.

So three of the artifacts here are generated or verified, not written:

| Check | First run found |
|---|---|
| `npm run docs:links` | **7 broken references**: a module deleted at level 12, a migration renumbered five levels ago, a spec renamed at level 14, a proxy path that was wrong in its brief from the start, and two documents this level was supposed to write |
| `npm run docs:env` | `TEST_AUTH_SECRET` documented **twice**, with two different warnings — a second entry silently overrides the first for anyone who copies the file |
| `npm run docs:activation:check` | (new) the matrix is generated from `src/contracts/flags.ts` and the live provider registry, so it cannot drift |

All three run in CI's quality job and inside `npm run verify`.

*"Your link checker skips the directories where the broken links actually are."*

It skips two trees and says why in the source. `.claude/skills/**` is vendored
by `npx skills add --copy` and its links point at its own repository; fixing
them would edit a bundle that `npm run skills:update` overwrites. `docs/reviews/`
and `docs/design/critiques/` are **dated records of a moment** —
`PR-03-self-review.md` says `src/app/page.tsx` because that is where the file
was at level 03, and rewriting the record to match today's tree would falsify
it. Living documentation is in scope; history is not.

*"`src/ai/test-principal.ts` appears in `ai-grounding.md` without backticks. That
is gaming your own check."* It is the convention the check creates, and it is
written down in `docs/README.md`: a path in backticks exists, a path that has
been deleted is named in plain prose. The alternative — teaching the checker a
"was at" escape hatch — is a hole anyone can drive a stale reference through.

## 2. The findings, and what they were

Every one was a document asserting something false about the repository:

| Document | Said | Reality |
|---|---|---|
| `docs/architecture/ai-grounding.md` | `src/ai/test-principal.ts` | Deleted at level 12 — the fifth swarm-local principal resolver, ported onto the shared one |
| `docs/architecture/rsvp-seating.md` | `src/db/migrations/0002_rsvp_seating.sql` | The chain is regenerated at every integration; that file never existed on `main` |
| `docs/sdlc/swarms/B-themes-lifecycle.md` | `src/app/proxy.ts` | `src/proxy.ts` — Next 16 resolves it from the project root. Wrong in the brief from the day it was written |
| `docs/sdlc/swarms/L-admin-ops.md` | `tests/e2e/admin.spec.ts` | `tests/e2e/admin-console.spec.ts` |
| `docs/ops/asset-licensing.md` | `public/assets/generated/` | Does not exist; no key is configured and nothing has been generated |
| `.env.example` | `TEST_AUTH_SECRET` twice | Merged, keeping the stronger warning |
| `plan.md` §2 | Levels 11–17 "Not started", level 03 "PR open" | All seventeen merged. **This was the hand-off document**, the first thing a new agent or the couple reads |

`plan.md` is the one worth dwelling on. It described a project state from
2026-09-05 and was the single most-read document in the repository. Sections 2,
5, 6 and 9 are rewritten to what is true; sections 3, 4, 7, 8 and 10 were
already true and are untouched.

## 3. Authorization

No capability, entitlement, route, schema or contract changed. The one code
change outside `scripts/` and `docs/` is `.env.example`, which removes a
duplicate entry.

## 4. Secrets and PII

`scripts/check-env-example.mjs` reads variable **names** and never values, and
its exempt list names `SECRETS_PRIVATE_KEY` explicitly as "read from `.secrets/`,
never from `.env`". `scripts/activation-matrix.ts` calls `describeProviders()`,
which is the same function `/api/health` uses precisely because it reports modes
and missing variable names and never a value. No `.env` file is read, printed or
committed by anything added here.

The threat model names what is deliberately **not** audited — one-time codes,
voucher codes, the text of a guest's dietary needs — because an audit trail that
leaks what it audits is worse than none.

## 5. Tests

The three checks are the tests, and each was run against the code it describes
and watched to fail:

- `docs:links` found 7 and now finds 0, over **77 documents, 91 relative links
  and 352 backticked repository paths**.
- `docs:env` found 2 and now finds 0, over **70 variables read, 80 documented,
  14 exempt by decision**.
- `docs:activation:check` passes against a freshly generated file and fails if
  either the flag registry or a provider's environment surface moves.

Deliberately not covered: prose accuracy. Nothing here checks that a sentence
about the capability layer is *true*, only that every path it names exists.
That limit is real and is why the threat model cites a test file for every
control rather than asserting the control exists.

One thing the generator caught that a hand-written table would have shipped:
`describeProviders()` with no database reports `jobs` as `unavailable`. Both
real callers pass a connection, so that is an artifact of measuring from a
script, not a product defect. The generator now says so in the output, derived
from the failure itself rather than special-cased by name.

## 6. Design

No component, token or stylesheet changed.

## 7. Accessibility and performance

No runtime change. `docs:check` adds roughly four seconds to `verify`, and the
activation-matrix generator boots the provider registry once.

## 8. Docs and ADRs

This level *is* the docs. No ADR changed: nothing here alters a decision.
`docs/README.md` is new and is the index every other document is reachable from.

## 9. TODO inventory

**Unchanged at 119**, and that is the honest headline of the whole level. No
document written here reduces the number of decisions the couple still owe, and
the evidence report says so in as many words rather than presenting a green
build as a finished product.

## 10. What a reviewer should push on

- **The threat model cites tests by name.** If a spec is renamed, `docs:links`
  catches it; if a spec is *gutted*, nothing here does. The threat model is only
  as good as the assertions inside the files it names.
- **`docs/ops/deploy-vercel-supabase.md` has never been executed.** No Vercel
  project, no Supabase project, no bucket exists. It is written from the code's
  own requirements — which variables boot-check, which throw, what the pooled
  connection is for — and every claim in it traces to `src/lib/env.ts` or
  `src/db/client.ts`. It is still a document about a thing nobody has done, and
  the first real deploy will find something in it wrong.
- **The activation matrix's "mode" column is the unconfigured state.** That is
  the state CI and a fresh clone run in, and it is the useful baseline, but an
  operator with keys set sees something else — `/admin/providers` is the live
  view and the document says so.

## 11. Verdict

**READY.** The level's value is the three gates, not the eight documents. The
weakest part is the deploy guide, named above; the strongest is that `plan.md`,
the hand-off document, now says something true.
