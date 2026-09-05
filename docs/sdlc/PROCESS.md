# Design + engineering SDLC — Sara + Tyler

How a surface goes from brief to shipped on this repo. Nine stages, each
with a gate. The design toolchain (see `../../CLAUDE.md`) is not optional
tooling around the process; it *is* the process.

Facts: `../design/brief.md` is the only source of wedding facts. Anything
else is `TODO(Tyler & Sara)` (see [Fact policy](#fact-policy)). Decisions:
`../adr/README.md`. Living design: `../design/design-doc.md`.

## Roles

| Role | Who | Does |
|---|---|---|
| Couple | Sara + Tyler | Supply facts, approve copy, pick between comps, own every `TODO(Tyler & Sara)` |
| Planner | Bustle & Lace | Timeline, room block, vendor facts (never their design IP — [ADR-0011](../adr/0011-content-provenance-and-freshness.md)) |
| Integrator | the parent Claude session (or Tyler) | Runs stages 1, 8, 9; commits; owns `main` and the stack |
| Swarm agent | a scoped sub-agent | Stages 2–7 inside an ownership manifest; never runs git |
| Reviewers | `design-reviewer`, `impeccable-finish-reviewer` agents; `/code-review`; `/security-review` | Read-only verdicts |

Ground rules for every agent: run `.claude/skills/impeccable/scripts/impeccable context --target <path>`
once per session before UI work; `DESIGN.md` (per theme) beats any skill's
taste; mobile 390px first; WCAG 2.2 AA; no raw hex or `font-family`
literals in components; never read or print `.env`.

## The nine stages at a glance

| # | Stage | Primary artefact | Gate |
|---|---|---|---|
| 1 | Brief | `docs/design/brief.md`, `PRODUCT.md` | Every fact has a source; unknowns are `TODO(Tyler & Sara)` |
| 2 | Research + inspo boards | `docs/design/inspo/<theme>.md` + `.html` | Board has all sections in the template; no pixels copied |
| 3 | Design doc + tokens | `docs/design/design-doc.md`, `src/themes/<id>/DESIGN.md` | `npx design.md lint` 0 errors per theme; diff reviewed |
| 4 | Direction comps | `comp` build path output | One comp per surface per theme, 390 + 1440 |
| 5 | Critique loop | `docs/design/critiques/<date>-<target>.md` | All axes ≥ 7, Usability ≥ 8 |
| 6 | Build | `src/**`, tests | `npm run quality` green; hook findings resolved |
| 7 | Adversarial self-review | `docs/reviews/PR-NN-self-review.md` | Verdict written; blockers fixed or ADR'd |
| 8 | Stacked PR | PR on `claude/wedding-NN-<slug>` | All CI gates green; base is previous level |
| 9 | Iterate | new critique → comps → `design.md diff` → `docs/design/CHANGELOG.md` | Changelog entry per accepted change |

---

## Stage 1 — Brief

**Purpose.** One page of truth: who the guests are, what the site must do,
what is known, what is not.

**Inputs.** Tyler's brief and the source documents he holds (CAA kit,
planner/photo/video/HMUA contracts, planning sheets). Never the documents
themselves in the repo — only extracted facts with provenance.

**Commands / skills.**

| Step | How |
|---|---|
| Domain checklist | Read `.claude/skills/wedding-site-standards/SKILL.md` §2 (pages), §3 (RSVP), §4 (copy) |
| Product brief | `/impeccable init` once; afterwards edit `PRODUCT.md` by hand and keep its section order |
| Unknowns | Add each to `docs/content/backlog.md` grouped by owner |

**Outputs.** `docs/design/brief.md` (facts table with a Source column, thesis,
principles, visual direction, IA, lifecycle, legal gates), `PRODUCT.md`,
`docs/content/backlog.md`.

**Exit gate.** Every fact in `PRODUCT.md` traces to a brief row. Nothing
marked "NOT settled" in the brief appears as prose anywhere.

**Who.** Integrator with the couple.

## Stage 2 — Research + inspo boards

**Purpose.** Extract *principles* from award-level references and the
building itself, per theme, before any pixels.

**Inputs.** Brief §4 (visual direction, anti-references), `wedding-site-standards` §6 study list.

**Commands / skills.**

| Step | How | Needs |
|---|---|---|
| Study a reference | `hallmark study <url>` (URL mode names exact fonts/colours; refuses template marketplaces; never copies pixels) | — |
| Font pairings | `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "art deco serif geometric sans wedding" --domain typography` | python3 |
| Palettes | `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "botanical creme sky gold" --domain color` | python3 |
| Whole-direction sanity | `… search.py "wedding hospitality editorial" --design-system -p "Sara + Tyler"` — compare, never override the brief | python3 |
| Aesthetic stance | Read `frontend-design` before writing any direction statement | — |
| Stitch prompt (optional) | `enhance-prompt` → `taste-design` (drafts an alternative DESIGN.md to compare) → Stitch MCP `generate_screen_from_text` | `STITCH_API_KEY` |
| Mood images (optional) | `FAL_KEY=… node scripts/fal-generate.mjs "<prompt>" --out .impeccable/review/<theme>-mood.png`; or `higgsfield-generate` after `npx higgsfield auth login` + `/mcp` | keys |
| Procedural art | `node scripts/generate-art.mjs <theme>` → `public/assets/art/<theme>/` | — |

**Outputs.** `docs/design/inspo/<theme>.md` (sections per
[`templates/inspo-board.md`](templates/inspo-board.md)) and a companion
`.html` board you can open in a browser. Commons files fetched via `scripts/fetch-commons.mjs` land in the
ledger (see [Placeholder-imagery policy](#placeholder-imagery-policy)).

**Exit gate.** Board covers every template section; every external image
has a ledger row; each "borrow" is a principle, not a layout.

**Who.** Swarm agent per theme.

## Stage 3 — Design doc + tokens

**Purpose.** Turn direction into machine-checkable tokens and a living
design document.

**Inputs.** Stage 2 boards, brief §4, `PRODUCT.md`.

**Commands / skills.**

```bash
# Write per-theme systems in Google's DESIGN.md spec (YAML front matter + rationale)
npx design.md lint src/themes/gilded-hour/DESIGN.md      # must be 0 errors (structure + WCAG contrast)
npx design.md lint src/themes/conservatory/DESIGN.md
npx design.md diff src/themes/gilded-hour/DESIGN.md src/themes/conservatory/DESIGN.md
npx design.md export --format css-vars src/themes/gilded-hour/DESIGN.md > src/themes/gilded-hour/tokens.css
npx design.md export --format css-vars src/themes/conservatory/DESIGN.md > src/themes/conservatory/tokens.css
```

Skills: `/impeccable shape <surface>` (plan UX before code);
`/impeccable document` (regenerate DESIGN.md from code once code exists);
`taste-design` (Stitch's opinionated draft, compared with `design.md diff`,
never merged blindly); `design-md` only if a Stitch project exists.

**Outputs.** `docs/design/design-doc.md`; `src/themes/<id>/DESIGN.md` +
exported `tokens.css`; a `design.md diff` pasted into the PR.

**Exit gate.** 0 lint errors for both themes; every theme token that the
shared component kit consumes exists in both files with the same name
(see [Theme-switching rule](#theme-switching-rule)); the diff is explained
in the design doc.

**Who.** Swarm agent per theme; integrator reconciles shared token names.

## Stage 4 — Direction comps

**Purpose.** A full-fidelity comp per surface per theme before implementation
(`.impeccable/config.json` sets `buildPath: "comp"`).

**Inputs.** `design-doc.md` page contract ("above the fold on 390px"),
theme DESIGN.md, `wedding-site-standards` §2 must-contain list.

**Commands / skills.**

| Step | How |
|---|---|
| Context | `.claude/skills/impeccable/scripts/impeccable context --target <route or file>` |
| Comp | `/impeccable craft <surface>` (comp-first; hallmark, design-anti-slop Mode A, frontend-design fire automatically) |
| Alternative canvas | the `design` skill (Claude Design canvas as an Artifact) for side-by-side artboards the couple can annotate |
| Stitch (optional) | `enhance-prompt` → Stitch `generate_screen_from_text` with the theme DESIGN.md uploaded |

**Outputs.** Comps at 390 and 1440 for each surface × theme, stored where
impeccable puts them (`.impeccable/`) and linked from the critique.

**Exit gate.** Comp contains every "must contain" item for its page type;
no anti-reference pattern; the couple has seen both themes for the surface.

**Who.** Swarm agent per theme.

## Stage 5 — Critique loop

**Purpose.** Score, not admire. Decide ship / fix first / redesign.

**Inputs.** Comp or route, `PRODUCT.md`, theme DESIGN.md, rubric
(`wedding-site-standards` §5: Design 40 · Usability 30 · Creativity 20 · Content 10).

**Commands / skills.** `design-review <route|file|url> [--quick]` — it chains,
in order: Playwright screenshots at 390/768/1440 → `npx impeccable detect --json`
→ `npm run design:lint` + raw-value grep → `hallmark audit` → `design-anti-slop`
Mode B → `/impeccable critique` + `/impeccable audit` → `web-design-guidelines`
→ `design-motion-principles` audit → axe (`BASE_URL=… npm run test:a11y`) →
`web-quality-audit` (deployed URL) → `wedding-site-standards` §8 checklist.

Delegate to the `design-reviewer` agent when the critique should not share
context with the builder.

**Outputs.** `docs/design/critiques/<YYYY-MM-DD>-<target>.md` from
[`templates/design-critique.md`](templates/design-critique.md) (the skill also
writes `.impeccable/critique/`; the docs copy is the one reviewed in the PR).

**Exit gate (ship gate).** Design ≥ 7, Usability ≥ 8, Creativity ≥ 7,
Content ≥ 7 for *each theme*. Detector findings are blockers unless waived
in `.impeccable/config.json` with a reason.

**Who.** `design-reviewer` agent or a swarm agent that did not build the target.

## Stage 6 — Build

**Purpose.** Implement the approved comp in `src/` against the shared
component kit; both themes must render from one route.

**Inputs.** Approved comp + critique, theme `tokens.css`, kit inventory in
`design-doc.md`.

**Commands / skills.**

| Concern | Skill / command |
|---|---|
| Every edit | impeccable PostToolUse hook runs automatically (`.claude/settings.json`); fix its findings before moving on; Stop hook summarises |
| Type | `/impeccable typeset <target>` |
| Spacing/rhythm | `/impeccable layout <target>` |
| Motion | `/impeccable animate <target>` with `design-motion-principles` build mode; reduced-motion is mandatory |
| Errors, i18n, edge cases | `/impeccable harden <target>` |
| Breakpoints | `/impeccable adapt <target>` (390 → 768 → 1440) |
| Copy | `/impeccable clarify <target>` (labels, errors) |
| Performance | `/impeccable optimize <target>`; `core-web-vitals` and `performance` skills for LCP/INP/CLS evidence |
| Quality | `web-quality-audit` on the preview URL |
| Final pass | `/impeccable polish <target>` |
| Gates | `npm run quality` (design:lint + slop:detect + lint:css); unit/integration/e2e per [ADR-0008](../adr/0008-stack.md) |

**Outputs.** Source, tests, updated `tokens.css` if tokens changed,
`design.md diff` if DESIGN.md changed.

**Exit gate.** `npm run quality` exit 0; tests green; the hook reports no
open findings; both themes screenshot-verified at 390px.

**Who.** Swarm agents within their ownership manifest.

## Stage 7 — Adversarial self-review

**Purpose.** Attack the change before anyone else does. Written, not felt.

**Inputs.** The level's diff, threat model items from ADRs
0001/0002/0005/0006, the critique.

**Commands / skills.**

| Pass | How |
|---|---|
| Correctness + simplification | `/code-review high` on the branch |
| Security | `/security-review` |
| Design, per theme | `design-reviewer` agent on each changed route |
| Direction contract | `impeccable-finish-reviewer` agent against the approved comp |
| Secrets/PII | `grep -rnE "(sk_|pk_|FAL_KEY|STITCH_API_KEY|BEGIN (RSA|EC) PRIVATE|@gmail\\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs` — paste the result |
| Authorization | Fill the route/action → capability → entitlement → IDOR test table |

**Outputs.** `docs/reviews/PR-NN-self-review.md` from
[`templates/self-review.md`](templates/self-review.md).

**Exit gate.** Every blocker either fixed in a new commit or converted into
an ADR/backlog item with an owner. No secrets, no PII, no invented facts.

**Who.** A different agent than the builder where possible; the integrator
signs.

## Stage 8 — Stacked PR

**Purpose.** Ship one reviewable level of the stack
([ADR-0010](../adr/0010-stacked-prs-adversarial-self-review.md)).

**Rules.**

- Branch `claude/wedding-NN-<slug>`; PR NN targets branch NN-1 (level 01
  targets `main`).
- Body from [`templates/pr.md`](templates/pr.md); links the self-review and
  critiques.
- Never force-push an open level. Fixes are new commits. Rebase only when
  the level below merges, and announce it in the PR.
- CI gates (required checks): `quality`, `unit`, `integration`, `e2e`,
  `evals` (AI grounding, mock models), `security`, `a11y`. Today
  `.github/workflows/design-quality.yml` provides `quality` and `a11y`; the
  rest arrive with the level that introduces the code they test.

**Exit gate.** All required checks green; self-review linked; the level
below is merged or explicitly stacked.

**Who.** Integrator.

## Stage 9 — Iterate

**Purpose.** Keep the design alive without drifting.

**Loop.** New critique (Stage 5) → new comps (Stage 4) → token change →
`npx design.md diff <before> <after>` → entry in
`docs/design/CHANGELOG.md` (date, theme, what changed, why, critique link).

**Exit gate.** No token changes without a changelog entry; no changelog
entry without a critique or couple decision behind it.

---

## Which skill when

| Skill | Stage(s) | Use it to | Do not use it to |
|---|---|---|---|
| `wedding-site-standards` | 1, 4, 5, 6 | Page must-contain lists, RSVP rules, copy standards, rubric, study list | Set visual direction |
| `impeccable` | 3–7 | `init`, `shape`, `craft`, `critique`, `audit`, `polish`, `typeset`, `layout`, `animate`, `harden`, `adapt`, `optimize`, `clarify`, `live`, `document`, `extract`, `detect` | Replace the brief |
| `hallmark` | 2, 5, 6 | `study <url>` (DNA extraction), `audit` (punch list), `redesign --mood` (structural rework) | Copy a reference's layout |
| `design-anti-slop` | 4, 5 | Mode A brief before generation; Mode B audit after | Decide tokens (DESIGN.md wins) |
| `frontend-design` | 2, 4 | Aesthetic stance, avoid templated defaults | Override theme DESIGN.md |
| `design-review` | 5, 7 | The whole review pipeline with a scored verdict | Edit anything |
| `web-design-guidelines` | 5, 6 | Vercel's rule set in `file:line` form | Judge creativity |
| `design-motion-principles` | 5, 6 | Build purposeful motion; audit for stagger-spam, bounce, missing reduced-motion | Add motion for its own sake |
| `accessibility` | 6, 7 | WCAG 2.2 fixes beyond axe: focus order, names, semantics | Skip axe |
| `web-quality-audit` | 5, 6, 7 | Lighthouse categories + agentic browsing on a preview URL | Static-only "audits" |
| `core-web-vitals` | 6 | LCP/INP/CLS with field + lab evidence | Micro-optimise before measuring |
| `performance` | 6 | Bundle, image, font loading | Change design tokens |
| `seo` | 6 | Metadata, `noindex` correctness, structured data where public | Make guest pages indexable |
| `best-practices` | 6, 7 | Security headers, modern APIs, code quality | Replace `/security-review` |
| `ui-ux-pro-max` | 2, 3, 6 | Search pairings, palettes, UX guidelines, stack notes; compare options | Override DESIGN.md |
| `enhance-prompt` | 2, 4 | Turn a rough comp idea into a Stitch prompt | Write copy |
| `taste-design` | 2, 3 | Draft an alternative DESIGN.md to compare via `design.md diff` | Replace the theme DESIGN.md |
| `design-md` | 3 | Synthesise DESIGN.md from an existing Stitch project | Anything without a Stitch project |
| `site-md` | 3 (optional) | A SITE.md constitution if the Stitch build loop is used | Duplicate PRODUCT.md |
| `higgsfield-generate` | 2, 4 | Mood images, textures, comp placeholders | Ship imagery as "photos of the couple" |
| `higgsfield-soul-id` | 2 (gated) | Identity-consistent comp imagery only with the couple's written consent and their own photos; never professional media (`PRO_MEDIA_AI_PROCESSING` off) | Anything involving guests' faces |
| `design` (canvas) | 4 | Multi-artboard canvas the couple can edit | Source of truth for tokens |
| `/code-review`, `/security-review` | 7 | Adversarial passes on the diff | Design judgement |

## Theme-switching rule

Two complete designs — **Gilded Hour** (Art Deco) and **Conservatory**
(Botanical) — over **one** content/domain layer
([ADR-0009](../adr/0009-theme-engine.md)).

1. Content, routes, data, capabilities, and copy are theme-agnostic. A theme
   never owns a fact.
2. Each theme has its own `src/themes/<id>/DESIGN.md`, `tokens.css`
   (CSS variables under `[data-theme="<id>"]`), component kit expressions,
   and page recipes. Structure may differ (symmetry vs. asymmetry); the kit
   *contract* (props, slots, a11y behaviour) does not.
3. Every surface ships in both themes or in neither. The critique scores
   each theme separately; the ship gate applies to both.
4. Resolution order: `?theme=` → cookie → default. The switcher is visible to
   everyone until a theme is chosen; after that it lives in the footer.
5. Token names are shared across themes; values differ. Adding a token to
   one theme without the other fails Stage 3.

## Placeholder-imagery policy

| Source | Allowed for | Rules |
|---|---|---|
| Procedural art (`node scripts/generate-art.mjs <theme>`) | Shipping placeholders, section ornaments, backgrounds | License-free by construction; regenerated, never hand-edited |
| Wikimedia Commons | Shipping placeholders for the building, Chicago, plants | Only CC0 / CC BY / CC BY-SA / public domain; fetched only via `node scripts/fetch-commons.mjs`, which refuses non-free licenses and writes the ledger (`public/assets/attributions.json` + `public/assets/ATTRIBUTIONS.md`: source URL, author, license, sha256, size, intended use); policy in `docs/ops/asset-licensing.md`; attribution rendered where the license requires |
| fal.ai / Higgsfield output | Mood boards, comps, unlisted placeholders during build | Never shipped as a "photo of the couple" or of any guest; replaced by real photography before the surface ships; stored under `.impeccable/review/` |
| Couple's own photos | Everything, once provided | Engagement/proposal photos are `TODO(Tyler & Sara)` until delivered |
| Professional media (Brooke Alaina, Oakhouse) | Private, non-commercial display on the site | No third-party AI or biometric processing without written confirmation (`PRO_MEDIA_AI_PROCESSING=false`) |
| CAA kit / Hyatt site photography, planner design materials | Nothing | Copyrighted; never ingested |

## Fact policy

- `docs/design/brief.md` §2 is the only source of wedding facts. Rows
  marked "NOT settled" are ideas, not facts.
- Unknown = `TODO(Tyler & Sara)` in code, copy, and docs, typed where
  possible (`TODO(Tyler & Sara): ceremony room`). Never plausible fiction,
  never a "temporary" date, room, rate, menu, or name.
- Operational facts (outlets, hours, rates, links) are data with
  `sourceId`, `verifiedAt`, `validFrom/validUntil`
  ([ADR-0011](../adr/0011-content-provenance-and-freshness.md)), never
  hard-coded prose. The CAA kit's closed outlets (Milk Room, Cherry Circle
  Room) are the standing example of why.
- A shipped page contains zero `TODO(Tyler & Sara)` strings; the backlog
  (`docs/content/backlog.md`) tracks who unblocks each.
- Durable venue history (1893, Cobb, Venetian Gothic, 1972, 2007, restoration)
  may be prose with a citation; the landmark designation date may not be
  published.

## Definition of done for a surface

- [ ] Comp critiqued for both themes; ship gate met
- [ ] Built with kit components; no raw hex / `font-family` literals
- [ ] `npm run quality` green; hook findings resolved
- [ ] Axe green on preview; keyboard-complete; 17px body; visible labels
- [ ] Prints legibly if it is a logistics page
- [ ] No `TODO(Tyler & Sara)` visible; operational facts carry provenance
- [ ] Self-review written; PR body complete; changelog entry if tokens moved
