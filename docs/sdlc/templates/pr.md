# PR NN — <title>

Stack level **NN** of 17 ([ADR-0010](../../adr/0010-stacked-prs-adversarial-self-review.md)).
Base: `claude/wedding-(NN-1)-<slug>` · Head: `claude/wedding-NN-<slug>`

## Summary

Three sentences: what a guest (or the couple, or an agent) can now do that
they could not before; what decision this level implements; what it leaves
for the next level.

## Scope by swarm

| Swarm / agent | Owned paths | Delivered | Not delivered (and where it went) |
|---|---|---|---|
| | | | |

Out of scope on purpose: 

## Validation

| Gate | Command | Result |
|---|---|---|
| quality | `npm run quality` | exit 0 |
| design lint (per theme) | `npx design.md lint src/themes/<id>/DESIGN.md` | 0 errors × 2 |
| unit | `npm run test:unit` | |
| integration | `npm run test:integration` | |
| e2e | `npm run test:e2e` | |
| evals | `npm run test:evals` | |
| security | `/security-review` | |
| a11y | `BASE_URL=<preview> npm run test:a11y` | |
| design review | `design-review <route>` per theme | scores |

Paste `npx design.md diff` output if any DESIGN.md changed.

## Self-review

`docs/reviews/PR-NN-self-review.md` — verdict: READY / READY WITH FOLLOW-UPS.

## Risks

| Risk | Likelihood | Blast radius | Mitigation / rollback |
|---|---|---|---|
| | | | |

## Activation notes

Flags, env vars, migrations, cron jobs, provider keys, or admin steps needed
after merge (e.g. `BIOMETRICS_ENABLED` stays `false`; `LIFECYCLE_OVERRIDE`
unset). State what happens if none are done.

## Stacked base

- Depends on PR (NN-1): `<link>` — merged / open
- Rebased after base merge: no / yes on YYYY-MM-DD (announced in comments)
- Never force-pushed while open: confirmed

## Docs

- ADRs: 
- `docs/design/CHANGELOG.md`: 
- `docs/content/backlog.md`: 

🤖 Generated with [Claude Code](https://claude.com/claude-code)
