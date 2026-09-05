# Self-review — PR NN `<slug>`

> Copy to `docs/reviews/PR-NN-self-review.md`. Written by someone other than
> the builder where possible. Every section is filled; "n/a" needs a reason.
> Process: [`docs/sdlc/PROCESS.md`](../PROCESS.md) Stage 7.

| Field | Value |
|---|---|
| Branch | `claude/wedding-NN-<slug>` |
| Base | `claude/wedding-(NN-1)-<slug>` |
| Reviewer | |
| Date | YYYY-MM-DD |
| Commands run | `/code-review high`, `/security-review`, `design-reviewer` ×2 themes, `impeccable-finish-reviewer`, `npm run quality` |

## 1. Hostile-reviewer pass

Read the diff as someone trying to reject it. One line per finding,
ranked conceptual → structural → visual → polish.

| # | Finding | Severity (blocker / should / nit) | Resolution (commit / ADR / backlog) |
|---|---|---|---|
| 1 | | | |

## 2. Authorization table

Every route or action this PR adds or changes ([ADR-0002](../../adr/0002-capability-layer.md)).

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test performed (ids swapped, other household, unauthenticated) | Result |
|---|---|---|---|---|
| | | | | |

Step-up required for any money/identity action? ([ADR-0001](../../adr/0001-guest-identity-vs-auth-identity.md)) — yes / no / n/a.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_|pk_|FAL_KEY|STITCH_API_KEY|BEGIN (RSA|EC) PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs
<paste output; expected: nothing, or only .env.example variable names>
```

- [ ] No guest names, emails, addresses, phone numbers, or table assignments in the repo
- [ ] No provider keys in client bundles ([ADR-0007](../../adr/0007-provider-adapters-and-fallbacks.md))
- [ ] EXIF/GPS stripped on any served derivative touched ([ADR-0005](../../adr/0005-media-storage-model.md))

## 4. Tests

| Area | Covered by (file) | Not covered — why / follow-up |
|---|---|---|
| Unit | | |
| Integration (PGlite) | | |
| E2E (Playwright) | | |
| Evals (AI grounding, mock models) | | |
| Axe | | |

## 5. Threat-model items touched

Tick each ADR whose threat model this PR touches and say how.

- [ ] 0001 identity (binding, OTP, passkeys, step-up):
- [ ] 0002 capabilities (entitlement, confirmation, idempotency):
- [ ] 0003 AI grounding (closed world, citations, verifier):
- [ ] 0004 external transactions (never merchant of record):
- [ ] 0005 media (private originals, signed URLs, quarantine):
- [ ] 0006 biometrics (flag off, vault isolation, consent ledger):
- [ ] 0011 provenance (sourceId/verifiedAt, trust classes):
- [ ] 0012 lifecycle (override, preview, state-gated routes):

## 6. Design verdict per theme

| Theme | Critique file | Design | Usability | Creativity | Content | Verdict |
|---|---|---|---|---|---|---|
| Gilded Hour | `docs/design/critiques/…` | | | | | |
| Conservatory | `docs/design/critiques/…` | | | | | |

`impeccable-finish-reviewer` material fixes remaining: none / list.

## 7. Accessibility and performance

- Axe (390px, 1440px): serious/critical count →
- Keyboard walk of every new interactive element: done / gaps →
- 17px body, visible labels, focus visible, reduced-motion honoured: yes / gaps →
- LCP / INP / CLS on preview (source: `web-quality-audit` / `core-web-vitals`): 
- Print check for logistics pages: yes / n/a

## 8. Docs and ADRs

- ADRs added/amended:
- `docs/design/design-doc.md` sections touched:
- `docs/design/CHANGELOG.md` entry: yes / not needed
- `docs/content/backlog.md` items closed or added:

## 9. TODO inventory

```
$ grep -rn "TODO(Tyler & Sara)" src | wc -l
```

| File | TODO | Visible to guests? | Owner |
|---|---|---|---|
| | | | |

## 10. Verdict

**READY / READY WITH FOLLOW-UPS / NOT READY** — one paragraph: what would
make a reviewer reject this and why it should merge anyway.
