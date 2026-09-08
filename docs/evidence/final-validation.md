# Final validation

What was built, what was measured, and the command that produced each number.
Written at level 17, the last level of the ladder in `plan.md`.

The rule this document follows, learned the hard way at level 09 and again at
level 10: **a claim and the command that produces it are the same artifact.**
Two measurements in this project were reported from a stale server and a stale
build; one detector result was reported as clean when re-running it returned
findings. Every number below is followed by how to get it again.

## What exists

| | Count | How to count it |
|---|---|---|
| Levels merged | 17 | `git log --oneline origin/main` |
| Capability handlers | 119 | `ls src/capabilities/*.ts src/capabilities/*/*.ts \| grep -v 'index\|registry\|context'` |
| Provider seams, each with a mock | 17 | `ls -d src/providers/*/` |
| Migrations in the chain | 10 | `ls src/db/migrations/*.sql` |
| ADRs | 12 | `ls docs/adr/0*.md` |
| Playwright specs | 28 in two arrangements | `node scripts/check-spec-coverage.mjs` |
| Public pages | 13 | `find 'src/app/(public)' -name page.tsx` |
| Guest pages | 8 | `find 'src/app/(guest)' -name page.tsx` |
| Admin pages | 28 | `find 'src/app/(admin)' -name page.tsx` |
| Designs | 2, switchable, sharing one domain | `ls src/themes/*/DESIGN.md` |

## The gates

```bash
NEXT_TURBOPACK_ROOT=/home/user npm run verify
```

runs, in order: `typecheck` · `eslint` · unit + UI · `stylelint` ·
`design.md lint` on all three DESIGN.md files · `design:sync:check` ·
**`docs:check`** (new at this level) · `impeccable detect .` · integration on
PGlite · evals · `next build`.

`npm run verify` does **not** run Playwright. That is a deliberate split — the
two browser arrangements need incompatible servers — and it is also a real hole
this level hit: a copy change can pass every local gate and fail CI, which is
exactly what happened on the pull request before this one. `npm run test:e2e`
and the two runners under `.data/run/` are how you close it locally.

### The three checks added at this level

| Command | What it prevents |
|---|---|
| `npm run docs:links` | A document pointing at a file that no longer exists. Found 7 on its first run, including a deleted module, a renumbered migration and a spec renamed two levels ago. |
| `npm run docs:env` | `.env.example` drifting from what the app reads. Found `TEST_AUTH_SECRET` documented twice with two different warnings. |
| `npm run docs:activation:check` | The operator's table of what is switched off drifting from the code that switches it. The table is generated, not written. |

All three run in CI in the quality job.

## What is switched off

Two legal gates, both off in code, both requiring a readiness switch in addition
to their environment variable, both covered by tests that assert the feature
stays inert while the gate is shut:

| Gate | Waits on |
|---|---|
| `BIOMETRICS_ENABLED` | Illinois BIPA review — retention schedule and consent language, backlog X-05 |
| `PRO_MEDIA_AI_PROCESSING` | Written permission from the photographer and videographer |

Every external system runs on its mock. That is the state a fresh clone, the
whole test suite and CI all run in; `docs/ops/activation-matrix.md` is generated
from the running registry and says what turns each one on.

## What is not finished, stated plainly

**The content is the launch gate, not the code.** 119 `TODO(Tyler & Sara)`
markers remain in the source, and 30 backlog items (C-01…C-10 couple, P-01…P-07
planner, V-01…V-03 vendors, X-01…X-10 cross-cutting) are open. No further
engineering moves that number. `docs/content/for-sara-and-tyler.md` is the
short version; `docs/content/backlog.md` is the full one, each item naming the
page it blocks.

Backlog **X-07** deserves its own line: *"how to reach us if you are stuck"*.
Every recovery path on the site — a wrong code, an expired link, a revoked
invitation, an email that never arrived — ends by pointing at that placeholder.
It is the one gap a code fix cannot close, and it is the most likely thing to
strand a real guest.

Deferred with reasons recorded on their pull requests:

- The `(auth)` tree measures **12.75px** on buttons and **15.94px** on hints
  against this repo's 17px floor. Level 16 fixed its missing `[data-theme]`; the
  type scale is a DESIGN.md question and is still open.
- Public prose is byte-identical in all nine lifecycle states, so `POST_WEDDING`
  still describes a future wedding.
- `/photos` offers face matching that `/media/me` says is off and staying off.
- Home and `/our-story` promise seven adventures where `/our-adventures` has one.
- 14 placeholders are written in the second person **to the couple**.

## Two detector results deliberately not silenced

Both were probed rather than suppressed, because a rule turned off repo-wide
stops catching the real thing:

1. **202 `[text-occlusion]` findings on the admin console.** The console
   navigation is a closed `<details>`. Chrome gives closed `::details-content`
   `content-visibility: hidden`, which skips painting but **keeps layout**, so
   find-in-page still reaches inside; the rule compares rectangles without
   asking whether an element renders. Silencing it means `display: none` and 21
   admin links out of find-in-page — a real regression traded for a green exit
   code. Reproduce: `node scripts/probes/occlusion.mjs /admin/guests`.
2. **`[heading-rhythm]` on Conservatory `/gifts`.** `.cv-section__head` and
   `.cv-prose` start at the same `top` — a two-column grid — so the "space below
   the heading" the rule measures is an adjacent column's height. Present on
   `main` before the level that was blamed for it, proved by reverting one file
   and re-running the identical command.

## What this run is actually about

Seventeen levels of features were built, and then six pull requests were spent
on something else: **reading the site as a guest and finding the places where it
says something untrue.** Those six found more real defects than any code review
in the run, and every one of them shipped under a green suite:

| | What a guest was told |
|---|---|
| #20 | Invented hotel and flight prices, shown as live partner rates |
| #21 | A settled fact glued to one nobody had decided; a registry that does not exist |
| #22 | Another household's members, inside your own RSVP |
| #23 | "Sign in" — to a guest who was already signed in; a lockout with no way out |
| #25 | Greeted by the household manager's name; "Answered for everyone" after one person |
| #26 | "Claim your invitation" — to a guest who had claimed; travel tools "not live" one tap from the live travel tools |

The pattern in all six is the same and is worth stating for whoever works on
this next: **a test suite proves the code does what the tests say. It cannot
tell you the site is describing a version of itself that does not exist.** The
three checks added at this level are the first mechanical defence against that
class, and they only cover the documentation.

## Residual risk

Named in full in `docs/architecture/threat-model.md`. The short list: an admin
account is the whole guest list and has no second factor beyond email plus a
five-minute step-up window; `script-src` carries `'unsafe-inline'` because the
documented alternative would destroy static rendering; `img-src https:` is wider
than a bucket origin; every live provider is a first integration on the day it
is switched on.
