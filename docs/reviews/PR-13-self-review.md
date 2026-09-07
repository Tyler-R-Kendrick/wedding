# Self-review — PR 13 `code-artifact-features` (feature labs)

| Field | Value |
|---|---|
| Branch | `claude/code-artifact-features-ac6eki` |
| Base | `main` (`18d4c05`, level 10) |
| Reviewer | authoring agent, adversarial pass before squash-merge |
| Date | 2026-09-07 |
| Commands run | `npm run quality` (exit 0), `npx impeccable detect .` (exit 0), `node docs/prototypes/build.mjs`, axe-core WCAG 2.2 AA over all 8 built labs (0 violations), a 10-assertion functional smoke test in Chromium, a 21-pair WCAG contrast calculation, secrets/PII grep |

## 0. What this is

Eight self-contained HTML harnesses under `docs/prototypes/` — seven feature
labs (levels 04–10) plus an index — so a reviewer can look at a surface
without running the app. No shipped code is touched.

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | The first pass stripped every `--art-*` token in the build and put nothing back, then rendered every section as a bordered card. The two kits are largely *made of* their ornament, so this shipped the shells of two design systems and called them the design systems. | **blocker** | Fixed. `build.mjs` now resolves each `--art-*` token to a URL-encoded `data:` URI of the real SVG; all eleven are back. Sections are full-bleed bands on the kits' alternating grounds at the spec's spacing. Verified: the hero's `::before` resolves to `url("data:image/svg+xml…")`, not a dead origin URL. |
| 2 | `pressGroup` queried `[data-labTheme]`, which matches nothing — the attribute is `data-lab-theme`. Both toggles were decorative: `aria-pressed` never updated, so the control lied to sighted and assistive users alike. | **blocker** | Fixed; the function now takes the literal attribute and the dataset key separately. Asserted in the smoke test on both the set and the clear. |
| 3 | The chrome declares `color-scheme: dark`, so the UA painted `<button>` text white. Household member names on the claim screen rendered white-on-white — invisible. | **blocker** | Fixed with a zero-specificity `:where(.site) button, input, select, textarea { color: inherit }` reset plus `.site { color-scheme: light }`. Asserted: zero elements with pure-white computed colour inside the visible site. |
| 4 | The type ramp used `vw`, which measures the browser window, not the device frame. The viewport toggle — the lab's whole reason for existing at three widths — never changed the type scale at all. | **blocker** | Fixed with `container-type: inline-size` on `.viewport` and `cqi` units. Asserted: display type goes 48.75px at 390 → 68px at 1240. |
| 5 | `--ink-faint` (#5d626d) was 3.13:1 on the wall and 2.90:1 on the control bar, both at 10–11px. A straight WCAG 2.2 AA failure in a repo whose stated bar is AA. | **should** | Fixed by raising the token to #7b8190 and moving `.chrome-bar` to `--ink-dim` (wall-3 is the lightest ground, where #7b8190 only reaches 4.18:1). All 21 text pairs now clear 4.5:1. |
| 6 | The artifact wrapper supplies `<html>` without a `lang`; axe rates this serious, and it was present on all eight pages. | **should** | Fixed in the shell script (and a small inline script on the index, which loads no shell). axe now reports 0 violations across all eight. |
| 7 | Unchecked radios rendered as filled discs against these grounds and read as *more* selected than the checked ones. | **should** | The control is drawn explicitly now (ring + dot, per kit). Asserted: checked and unchecked box-shadows differ. |
| 8 | The index had two cascade/grid defects: `.opener p` (0,1,1) beat `.opener-date` (0,1,0) and forced the date motif to 16px; `.lab-go` had no `grid-column` and displaced the text into column 3. | **nit** | Both fixed. Exactly the "selector specificities cancelling each other out" failure the design guidance warns about. |
| 9 | **The markup is hand-written, not the real components.** Only the tokens and the art are guaranteed in sync (they are inlined from source at build time). If a real page recipe changes, the lab will silently disagree with it. | **should — accepted, documented** | Stated in `README.md` and in the PR body. These are review instruments, not a rendering of the app. The honest alternative — building against the real Next.js recipes — is what `npm run dev` already does. |
| 10 | 864 kB of generated HTML committed, because both kits' tokens and all eleven art assets are duplicated into each of the eight files. | **nit — accepted** | Deliberate: each lab must open standalone and publish as one artifact. Sources are 276 kB; the generated files are reproducible from `build.mjs` and committed only so the labs open without a build step. |
| 11 | Two visible `<h1>` per lab (the masthead and the active scene). | **nit** | Accepted. The masthead is the lab's own title and the scene is the site's; axe reports no heading-order violation. Collapsing the masthead to `<h2>` would misrepresent the page's own structure. |
| 12 | `--mono` (a chrome token) is used inside `.site` for the OTP field, violating my own "no chrome tokens inside `.site`" rule. | **nit — accepted** | A one-time-code field genuinely wants a monospace face and neither kit defines one. Documented in the PR body rather than left as a silent inconsistency. |
| 13 | The chrome commits to a single dark world instead of following the viewer's theme. | **nit — by design** | A darkened gallery makes the two light kits read as lit objects. Called out to the user as a reversible choice. |

## 2. Authorization table

No runtime code, no capability handlers, no data access. The labs render
static markup. `n/a`.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_…|pk_…|BEGIN … PRIVATE|@(gmail|yahoo|hotmail|outlook)\.com|[0-9]{3}-[0-9]{3}-[0-9]{4}|AKIA…)" docs/prototypes/
none
```

- [x] Guest data is the committed fictional fixtures only: Ada / Ben / Cleo Testhouse, Dev / Eve Fixture, Fin Solo
- [x] No `example.test` addresses rendered in full; the claim screen shows the masked form (`a•••@e•••.test`)
- [x] No voucher codes — the ride benefit renders `TODO-CODE`
- [x] Outbound `href`s are only the seven artifact URLs and Google Fonts

## 4. Tests

| Area | Covered by | Not covered, why |
|---|---|---|
| Accessibility | axe-core WCAG 2.2 AA over all 8 built labs — **0 violations** | — |
| Contrast | 21-pair ratio calculation over both kits and the chrome — **0 below 4.5:1** | — |
| Behaviour | 10-assertion Chromium smoke test: width ramp, both toggles, kit token + art resolution, no white-on-white, keyboard flow advance, radio states — **10/10** | Not wired into CI; the labs are docs, and CI does not build them |
| Repo gates | `npm run quality` exit 0, `npx impeccable detect .` exit 0, CI green on `75f65da` | The detector excludes `docs/**`, so it never inspected these files — a weak signal, stated as such |
| Drift | `build.mjs` inlines tokens and art from source, so a token change plus a rebuild cannot silently diverge | Nothing fails the build if someone edits a token and forgets to rebuild; there is no `design:sync:check` equivalent for the labs |

## 5. Threat-model items touched

- [x] **0011 provenance** — every `TODO(Tyler & Sara)` renders as a visible placeholder (engraved blank plate / unfilled specimen tag); no invented fact, room, time, rate or hotel appears anywhere.
- [x] **Guest data** — fixtures only; nothing derived from a real guest list.
- [ ] No auth, storage, external-action or biometric surface is exercised. The labs depict those flows; they do not implement them.

## 6. Design verdict

Reviewed against `src/themes/*/DESIGN.md` rather than by eye alone. Both kits
now render their own type ramp, spacing scale, component treatments
(`section-inverse`, `section-alt`, `section-lake`/`sky`, `card`, `button-*`)
and procedural ornament. The numeral plaque and the specimen-tag placeholder
are the kits' own devices, not invented decoration.

Remaining weakness is finding 9: fidelity is to the *design system*, not to
the shipped component tree.

## Verdict

**READY.** Four blockers found and fixed during this review, all of them
caught by looking at the rendered page rather than the source. Findings 9–13
are accepted and documented rather than resolved.
