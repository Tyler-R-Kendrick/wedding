# Design critique — `<target>` — `<theme>` — YYYY-MM-DD

> Copy to `docs/design/critiques/<YYYY-MM-DD>-<target>-<theme>.md`. Produced by
> the `design-review` skill or the `design-reviewer` agent; never by the
> builder. One critique per theme. Rubric: `wedding-site-standards` §5.

| Field | Value |
|---|---|
| Target | route / file / URL / comp |
| Theme | Gilded Hour / Conservatory |
| Lifecycle state previewed | e.g. `RSVP_OPEN` |
| Viewports captured | 390×844, 768×1024, 1440×900 |
| Reviewer | |
| Pipeline | full / `--quick` (say what was skipped and why) |

## Verdict: SHIP | FIX FIRST | REDESIGN

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | | typographic hierarchy, composition, photo pacing, restraint, DESIGN.md conformance, no slop tells |
| Usability | 30 | | logistics ≤ 2 taps, RSVP < 2 min on a phone, WCAG 2.2 AA, LCP < 2.5 s, prints |
| Creativity | 20 | | at least one idea that is *theirs* |
| Content | 10 | | real words, complete logistics, no `TODO(Tyler & Sara)` visible |

Ship threshold: all ≥ 7 and Usability ≥ 8.

## Blockers (must fix)

Ranked by layer: conceptual → structural → visual → polish. One finding, one
line, first source wins. Quote `DESIGN.md` / `PRODUCT.md` for conformance findings.

- [source] finding → fix

## Should fix

- [source] finding → fix

## Consider

- [source] finding → fix

## Keep (what is working)

- 

## Evidence

- Screenshots: `.impeccable/review/<date>-390x844.png`, …
- `npx impeccable detect --json`: N findings (rule ids: …)
- `npm run design:lint`: 0 errors / list
- Raw hex / `font-family` grep: none / list
- hallmark audit: N items; design-anti-slop Mode B: N new items
- `/impeccable critique` score: … ; `/impeccable audit`: …
- web-design-guidelines: `file:line` list or n/a
- Motion audit: n/a / report path
- Axe: N serious / N critical
- web-quality-audit: LCP … INP … CLS …
- `wedding-site-standards` §8 checklist: items missing

## Next command

The single most valuable next step, e.g. `/impeccable polish /rsvp`,
`hallmark redesign src/app/(public)/story --mood editorial`, or
`/impeccable adapt src/themes/conservatory/recipes/home.tsx`.
