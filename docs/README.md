# Documentation

Start here. Every document below is current; documents that record a moment
(pull-request self-reviews, design critiques, inspiration boards) live in their
own directories and are deliberately **not** updated as the code moves.

`npm run docs:check` fails the build if anything on this page points at
something that does not exist, if `.env.example` drifts from what the app reads,
or if the activation matrix drifts from the code that switches things on.

## If you are Sara or Tyler

| Read | For |
|---|---|
| [What we still need from you](content/for-sara-and-tyler.md) | The short list. Everything a launch waits on. |
| [The content backlog](content/backlog.md) | The same list in detail, each item with the page it unblocks. |
| [Admin console guide](ops/admin-guide.md) | How to enter it all, and what each screen does. |

## If you are running the site

| Read | For |
|---|---|
| [Local development](ops/local-dev.md) | Clone to running site. No accounts, no keys. |
| [Deploying](ops/deploy-vercel-supabase.md) | Vercel + Supabase + R2, in the order that works. |
| [Environment variables](ops/environment.md) | Every variable, its default and who reads it. |
| [Activation matrix](ops/activation-matrix.md) | What is switched off, and exactly what turns it on. Generated from the code. |
| [Secrets](ops/secrets.md) | How keys reach this repository without being committed. |
| [Asset licensing](ops/asset-licensing.md) | Where every image came from and what we owe for it. |
| [Professional media rights](ops/professional-media-rights.md) | The photographer/videographer gate on AI processing. |

## If you are changing the code

| Read | For |
|---|---|
| [Architecture overview](architecture/overview.md) | The shape of the whole thing. |
| [Capability layer](architecture/capability-layer.md) | The one door every surface goes through. Read this before adding a feature. |
| [Threat model](architecture/threat-model.md) | What is worth stealing, what stops it, and the test that proves it. |
| [Providers and fallbacks](architecture/providers.md) | Every external system and its mock. |
| [Content model](architecture/content-model.md) and [provenance](architecture/provenance.md) | Where a fact comes from and how the site says it is uncertain. |
| [Theme engine](architecture/theme-engine.md) | Two completely different designs over one domain. |
| [SDLC process](sdlc/PROCESS.md) | How a change gets from an idea to a merged pull request. |
| [ADRs](adr/README.md) | The twelve decisions everything else follows from. |

Domain notes, one per area:
[identity](architecture/identity.md) ·
[RSVP and seating](architecture/rsvp-seating.md) ·
[travel](architecture/travel.md) ·
[external actions](architecture/external-actions.md) ·
[media](architecture/media.md) ·
[media intelligence](architecture/media-intelligence.md) ·
[biometrics readiness](architecture/biometrics-bipa-readiness.md) ·
[AI grounding](architecture/ai-grounding.md) ·
[WebMCP](architecture/webmcp.md)

## The record

| Where | What |
|---|---|
| [`docs/evidence/final-validation.md`](evidence/final-validation.md) | What was measured, with the command that produced each number. |
| `docs/reviews/` | One adversarial self-review per pull request, written before it opened. |
| [`docs/design/brief.md`](design/brief.md), [`design-doc.md`](design/design-doc.md) | What was asked for, and the design that answers it. |
| `docs/design/critiques/` | Every design review round, scored. |
| `docs/sdlc/swarms/` | What each parallel agent was told to build. |
| [`plan.md`](../plan.md) | The build plan and the status of every level. |

## Three conventions worth knowing

**A fact nobody has decided is written as `TODO(Tyler & Sara)`, never as
plausible fiction.** The site renders it as "Sara + Tyler are still writing
this". Inventing a venue capacity or a registry to fill a gap is treated here as
a defect of the same seriousness as a data leak.

**Internal ticket references stay in the content record.** `(backlog C-01)` and
its bare form `(C-01)` are editorial metadata; they never reach a guest, an
export, or the AI corpus. One regex enforces that, in
`src/domain/content/text.ts`.

**A path in backticks in these documents exists.** `npm run docs:links` fails
the build otherwise. A file that has been deleted is named in plain prose, so
the check stays strict and history stays honest.
