# Self-review — PR 02 `design-sdlc`

| Field | Value |
|---|---|
| Branch | `claude/wedding-02-design-sdlc` |
| Base | `claude/wedding-site-design-tools-lhs4i1` (level 01) |
| Reviewer | integrator (parent agent), adversarial pass over four swarm outputs |
| Date | 2026-09-05 |
| Commands run | `npm run quality` (design lint ×3, detector, stylelint, asset ledger check), `npx design.md diff`, Playwright screenshots of both boards at 390/1440, secrets grep |

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | "This is 100 KB of HTML per inspo board and thousands of lines of docs, where is the site?" Fair. Level 02 is deliberately the design/SDLC layer the brief asked for (design doc, inspo boards); the app starts at level 03, already in progress in a worktree. | should | Accepted; ADR-0010 ladder |
| 2 | Content axis is weak: every story/adventure/venue copy block is `TODO(Tyler & Sara)`. | should | By policy (no invented facts); tracked in `docs/content/backlog.md` |
| 3 | Boards depend on Google Fonts at view time; in a locked-down network they render in fallback faces (the sandbox screenshots did). | nit | Level 04 self-hosts the six OFL faces; fallback stacks are set |
| 4 | 4.7 MB of Commons JPEGs in git history. | nit | Acceptable for four hero placeholders; level 10 serves derivatives from object storage; originals stay for provenance |
| 5 | `scripts/fetch-openverse.mjs --download` fetches from whatever file host the API returns (not pinned). | nit | Dev-only script, never runs server-side; documented in `docs/ops/asset-licensing.md` |
| 6 | Two agents wrote the two `design.json` sidecars with slightly different `motion`/`ornaments` shapes. | should | Level 04 defines `MotionSpec`/ornament types and normalizes both; noted in swarm B brief |
| 7 | `PROCESS.md` names seven CI gates; only `quality` and `a11y` exist today. | nit | Each level adds the gate that tests what it introduces (ADR-0010) |
| 8 | Root `DESIGN.md` still carries the "Editorial Romance" name and terracotta accent while being repurposed as the admin foundation. | nit | Repurposing documented at the top of the file; retune at level 14 if the admin UI needs it |
| 9 | Gilded Hour's "Big Shoulders Display" may be superseded by the merged "Big Shoulders" variable family on Google Fonts. | should | Level 04 picks the file to self-host and keeps the family name in sync (recorded in the board's open questions) |
| 10 | The theme agents scored their own boards; self-scores are not a review. | should | The real gate is `design-review` on rendered pages at level 04 |
| 11 | Secret Drop (added after the first review): the sandbox private key lives on an ephemeral container and the artifact store holds ciphertext readable by anyone who can open the private page. | should | Accepted: envelopes are AES-256-GCM + RSA-OAEP-4096, the agent is denied `.secrets/private*` and `.env`, and the durable-key flow keeps the long-lived private key in the user's environment settings only. |
| 12 | `scripts/secrets/apply-env.mjs` writes `.env` from data the agent fetched from the artifact store; a poisoned envelope could inject an arbitrary variable name. | nit | Names are validated against `^[A-Z][A-Z0-9_]{0,63}$`, values are dotenv-quoted, existing lines are only replaced by name, and the script prints names/lengths only. |
| 13 | `autofill.mjs` generates session secrets with `randomBytes(32)` but also sets local URLs that a deployer might forget to override. | nit | It never overwrites a non-empty value and the deployment guide lists the production-required variables. |

## 2. Authorization table

No routes or actions in this level (docs, tokens, scripts, assets only). n/a: first server code lands at level 03.

## 3. Secrets and PII grep

Re-run after the secrets tooling landed (`scripts/secrets/*`, `docs/ops/secrets.md`): still none. The only key material in the diff is the sandbox PUBLIC JWK (`.secrets/public.jwk.json`).

```
$ grep -rnE "(sk_…|pk_…|BEGIN … PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src docs scripts public/assets/ATTRIBUTIONS.md public/assets/attributions.json
none
```

- [x] No guest names, emails, addresses, phone numbers, or table assignments in the repo (the only people named are the couple, vendors, and Commons photographers, all public)
- [x] No provider keys anywhere; `.env.example` has empty values only
- [x] EXIF/GPS: the Commons files are Wikimedia renditions (no personal GPS); served derivatives are a level-10 concern

## 4. Tests

| Area | Covered by | Not covered, why |
|---|---|---|
| Design tokens | `npm run design:lint` (root + 2 themes, 0 errors / 0 warnings) | |
| Anti-slop | `npm run slop:detect` over the repo (exit 0; one documented `cream-palette` waiver in the Conservatory board, justified by brief §4) | |
| Asset licensing | `npm run assets:check` (4/4 ledger entries hash-verified) | Openverse search returned 504s; no Openverse assets yet |
| Art generation | `node scripts/generate-art.mjs` deterministic; XML well-formedness checked by both agents | No snapshot test yet (level 04 adds one) |
| Boards | Playwright screenshots at 390/1440, no horizontal scroll | Automated axe on boards not run (they are docs, not shipped pages) |

## 5. Threat-model items touched

- [ ] 0001–0006, 0012: not touched (no runtime code)
- [x] 0011 provenance: every seedable fact in `docs/design/brief.md` carries a source; the stale CAA-kit outlets are the canonical stale example; the asset ledger is provenance for imagery

## 6. Design verdict per theme

| Theme | Artifact reviewed | Design | Usability | Creativity | Content | Verdict |
|---|---|---|---|---|---|---|
| Gilded Hour | `docs/design/inspo/gilded-hour.html` (screenshots 390/1440) | 8 | 8 | 7 | 6 | direction approved for level 04 |
| Conservatory | `docs/design/inspo/conservatory.html` (screenshots 390/1440) | 8 | 8 | 8 | 6 | direction approved for level 04 |

Integrator notes: the two directions are structurally different (centered plaque vs. off-centre herbarium sheet; frieze/elevator nav vs. kraft tag rail; gold geometry vs. line-art foliage). Content scores are low by construction (placeholders). Page-level `design-review` runs happen at level 04.

## 7. Accessibility and performance

- Boards: 17–18 px body text, computed contrast tables, no horizontal scroll at 390 px; both themes reserve saturated fills for washes and use readable inks for text.
- Not applicable yet: bundle size, LCP.

## 8. Docs / ADRs / TODO inventory

- 12 ADRs, PROCESS.md, templates, swarm briefs B–L, design doc, backlog, asset policy, CHANGELOG.
- `TODO(Tyler & Sara)` inventory: PRODUCT.md (7), theme boards (room, plants, monogram wording, deadline), backlog (18 + 6 derived).

## Verdict

**READY WITH FOLLOW-UPS** (items 6, 9, 10 land at level 04).
