# Self-review — PR 01 `site-design-tools` (toolchain)

| Field | Value |
|---|---|
| Branch | `claude/wedding-site-design-tools-lhs4i1` |
| Base | `main` |
| Reviewer | integrator (parent agent), written after the fact before squash-merge |
| Date | 2026-09-05 |
| Commands run | `npm run quality` (design lint, detector, stylelint), `npx playwright test` (skips without BASE_URL), impeccable `context` / `hooks status`, detector smoke test on a deliberately bad page |

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | 324 files and ~114k added lines, mostly vendored third-party skills. A reviewer cannot read them all. | should | Skills are copied verbatim from pinned sources recorded in `skills-lock.json`; `npm run skills:update` refreshes them deliberately, never automatically. Provenance of each is in `docs/research/design-tooling.md`. |
| 2 | Vendored skills execute instructions when loaded; a malicious update could steer the agent. | should | Level-03 review (N17) flagged `npm run skills:update` auto-approval; level 15 removes it from the allowlist. Until then updates are a manual, reviewed action. |
| 3 | `impeccable` ships a launcher that downloads a native engine binary at first run. | should | Download is version-pinned, sha256-verified against a sidecar, and comes from the project's GitHub releases; documented in `CLAUDE.md` Maintenance. |
| 4 | The root `DESIGN.md` direction (Caslon/Newsreader/terracotta) was superseded one level later. | nit | Repurposed as the admin/shared foundation at level 02 with a note at the top of the file. |
| 5 | `.env.example` was denied to the agent by an over-broad `Read(./.env.*)` rule. | nit | Narrowed at level 02 to `.env`, `.env.local`, `.env.production`, `.env.*.local`. |
| 6 | `tests/a11y.spec.ts` is a placeholder until a site exists. | nit | It skips explicitly (not silently) and is wired into CI so it activates when `BASE_URL` is set. |

## 2. Authorization table

No runtime code. n/a.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_…|pk_…|BEGIN … PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src docs scripts .claude/skills/wedding-site-standards .claude/skills/design-review
none
```

- [x] `.env`, `.claude/settings.local.json`, `.impeccable/config.local.json` ignored
- [x] `.mcp.json` uses `${FAL_KEY}` / `${STITCH_API_KEY}` expansion, no literal keys

## 4. Tests

| Area | Covered by | Not covered, why |
|---|---|---|
| Design tokens | `npm run design:lint` (0 errors / 0 warnings) | |
| Anti-slop | `npm run slop:detect` (exit 0); detector smoke test flagged side-tab, purple gradient, glow, Inter, contrast, heading skip on a bad fixture | |
| Hooks | impeccable hook exercised with a fake PostToolUse payload (exit 0) | |
| Accessibility | Playwright + axe harness present, skips until `BASE_URL` | no site yet |

## 5. Threat-model items touched

- [x] 0011 provenance: `PRODUCT.md` establishes the `TODO(Tyler & Sara)` fact policy the whole stack inherits.

## 6. Design verdict

No pages. The toolchain itself is the deliverable.

## Verdict

**READY** (follow-ups tracked at levels 02 and 15).
