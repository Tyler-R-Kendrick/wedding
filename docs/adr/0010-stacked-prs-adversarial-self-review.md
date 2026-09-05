# ADR-0010: Stacked PRs with adversarial self-review between levels

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | `docs/sdlc/PROCESS.md` Stages 7–8, `docs/sdlc/templates/{self-review,pr}.md` |

## Context

Work is produced by parallel agent swarms with one human integrator. Large
PRs are unreviewable; parallel agents on one branch produce merge
conflicts; force-pushes destroy review context. Every level must be
individually defensible, and the attacker is us.

## Decision

### The 17-level stack

Branch `claude/wedding-NN-<slug>`; PR NN targets the branch of NN-1 (01
targets `main`). Levels are a plan; slugs after 02 may be renamed when the
level opens, but numbering is stable.

| NN | Slug | Delivers | ADRs |
|---|---|---|---|
| 01 | `design-toolchain` | skills, linters, CI `quality` + `a11y` | — |
| 02 | `design-sdlc` | brief, two themes, SDLC, ADRs, design doc | all |
| 03 | `app-scaffold` | Next.js 16 + Tailwind v4, theme engine, `proxy.ts`, `/t/[theme]` | 0008, 0009 |
| 04 | `domain-data` | Drizzle schema, PGlite/Supabase, provenance fields, lifecycle machine | 0011, 0012 |
| 05 | `identity` | Better Auth OTP + passkeys, bindings, step-up | 0001 |
| 06 | `capabilities` | registry, entitlements, idempotency, audit, WebMCP manifest | 0002 |
| 07 | `story-surfaces` | Home, Our Story, Our Adventures, Explore CAA — both themes | 0009 |
| 08 | `logistics-surfaces` | The Wedding, Travel & Stay, Transportation, Gifts | 0004, 0011 |
| 09 | `rsvp-your-weekend` | RSVP, household management, Your Weekend | 0001, 0002 |
| 10 | `share-an-adventure` | recommendations, itineraries, memory layer | 0011 |
| 11 | `media-pipeline` | uploads, quarantine, derivatives, gallery, Photos & Video | 0005 |
| 12 | `concierge` | Ask Us: retrieval, tools, citations, verifier, evals gate | 0003 |
| 13 | `provider-adapters` | registry/lodging/flights/rides/reservations adapters + ladder | 0004, 0007 |
| 14 | `admin` | lifecycle override/preview, content editing, moderation, freshness | 0011, 0012 |
| 15 | `biometrics-gated` | vault schema, consent ledger, jobs — flag off | 0006 |
| 16 | `hardening` | security, a11y, perf, print, noindex, observability | 0008 |
| 17 | `launch` | TEASER go-live, runbooks, archive export plan | 0012 |

### Rules

1. **Adversarial self-review between every level.** No PR opens without
   `docs/reviews/PR-NN-self-review.md` (template in
   `docs/sdlc/templates/self-review.md`) written by an agent other than the
   builder where possible, running `/code-review high`, `/security-review`,
   `design-reviewer` per theme, and `impeccable-finish-reviewer`.
2. **Never force-push an open level.** Fixes are new commits. Rebase only
   after the base merges; announce it in the PR.
3. **CI gates** (`quality`, `unit`, `integration`, `e2e`, `evals`,
   `security`, `a11y`) are required checks; a gate that does not yet exist
   is added by the level that introduces what it tests.
4. **Merge order is stack order.** A level may not merge before its base.

### Integration protocol for parallel swarms

1. The integrator opens the level branch and writes an **ownership
   manifest** in the kickoff prompt: each swarm agent gets a disjoint set
   of paths it may create or modify. Shared files (`package.json`, lockfiles,
   `PRODUCT.md`, root configs) belong to the integrator unless assigned.
2. **Agents never run git.** They write files; the integrator reviews and
   commits per swarm, in a fixed order (domain → capabilities → UI → docs),
   so later commits build on earlier ones.
3. Cross-swarm interfaces (types, token names, component contracts) are
   written first by the integrator or a designated agent and frozen for the
   level; a change to a frozen interface is a new commit by the integrator
   with a note in the PR.
4. Each agent reports: files written, inconsistencies found, open
   questions. Inconsistencies become PR comments or backlog rows before
   merge.
5. Facts, copy, and tokens are never invented by a swarm; unknowns are
   `TODO(Tyler & Sara)` and appear in the self-review §9 inventory.

## Consequences

**Positive.** Every level is small enough to reject. Review context
survives. Parallel work has no merge conflicts by construction.

**Negative / costs.** Seventeen reviews; base-branch churn when an early
level changes. Ownership manifests need discipline; an agent that strays
costs a commit rollback.

**Follow-ups.** `docs/reviews/` directory created at level 03. Branch
protection with required checks once gates exist.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Feature branches merged independently | Levels depend on each other (auth before RSVP); order matters |
| One long-lived branch | Unreviewable; a single bad commit blocks everything |
| Trunk-based with flags only | Agents pushing to trunk removes the human gate |

## Compliance

- PR body follows `docs/sdlc/templates/pr.md` and links the self-review.
- `git log` on a level shows no force-push (reflog) while open.
