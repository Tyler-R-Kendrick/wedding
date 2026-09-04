---
name: design-review
description: Run the full design-quality review pipeline on a page, component, URL, or screenshot of the wedding site — screenshots at phone/tablet/desktop, anti-slop audits (hallmark, design-anti-slop, impeccable critique + audit), Vercel web-interface guidelines, motion audit, axe accessibility, and the deterministic impeccable detector — then write a scored report to .impeccable/critique/. Use when asked to "review the design", "critique this page", "is this good enough to ship", "design QA", "run the review", or before marking any surface done.
version: 1.0.0
argument-hint: "<route | file | URL | screenshot> [--quick]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - WebFetch
  - Bash(npx playwright *)
  - Bash(npx impeccable *)
  - Bash(.claude/skills/impeccable/scripts/impeccable *)
  - Bash(npm run *)
  - Bash(npx design.md *)
---

# Design review pipeline

One command that composes every reviewer installed in this repo into a
single, scored verdict. It **never edits** the target; it reports. Fixing
is a separate step (`/impeccable polish`, `hallmark redesign`, etc.).

Load context first: `PRODUCT.md`, `DESIGN.md`, and the
`wedding-site-standards` skill (§5 rubric, §8 checklist).

## Inputs

- A **route** (`/rsvp`) or **URL** (`http://localhost:4321/rsvp`) — full
  pipeline with screenshots.
- A **file or directory** (`src/components/Hero.astro`) — static passes
  only (no screenshots unless a dev server is running).
- A **screenshot** — visual passes only.
- `--quick` — skip axe, motion, and web-quality; keep detector + critique.

If a URL is needed and no server is running, say so and run the static
passes; do not fabricate screenshots.

## Pipeline (run in this order, collect findings as you go)

### 1. Capture (URL/route only)
```bash
mkdir -p .impeccable/review
for w in 390x844 768x1024 1440x900; do
  npx playwright screenshot --browser=chromium --viewport-size=${w/x/,} --full-page \
    "$URL" ".impeccable/review/$(date +%F)-${w}.png"
done
```
Read each screenshot. Note anything that breaks at 390px first — mobile
is the primary canvas.

### 2. Deterministic detector (always)
```bash
npx impeccable detect --json "$TARGET"     # file/dir, or the URL
```
Exit 2 = findings. Every finding is a **blocker** unless a documented
waiver exists in `.impeccable/config.json`.

### 3. Design-token conformance (always)
```bash
npm run design:lint
```
Then grep the target for raw hex colors and `font-family` declarations
that are not tokens from `DESIGN.md`. Raw values are findings.

### 4. Anti-slop audits (always)
- **hallmark**: follow `hallmark audit <target>` from the `hallmark` skill —
  ranked punch list, no edits.
- **design-anti-slop**: run Mode B (post-generation audit) from the
  `design-anti-slop` skill against the same target; keep only findings not
  already raised by hallmark.
- **impeccable**: run `/impeccable critique <target>` (hierarchy, clarity,
  emotional resonance) and `/impeccable audit <target>` (a11y, performance,
  responsive). Run `scripts/impeccable context --target <path>` first as
  the skill instructs.

### 5. Interface guidelines (skip with --quick)
Follow the `web-design-guidelines` skill on the target files (it fetches
Vercel's current rule set) and report in its `file:line` format.

### 6. Motion (skip with --quick; skip if the target has no motion)
Run the **audit** mode of `design-motion-principles`. Flag stagger-spam,
bounce/elastic easing, pulsing indicators, and missing
`prefers-reduced-motion` handling.

### 7. Accessibility & quality (URL only; skip with --quick)
```bash
BASE_URL="$ORIGIN" npm run test:a11y
```
Then, for a deployed URL, run the `web-quality-audit` skill (Lighthouse
categories, Core Web Vitals) and report LCP/INP/CLS.

### 8. Domain checklist (always)
Walk `wedding-site-standards` §8 for the page type. Missing logistics are
**Usability** findings, not nits.

## Report

Write `.impeccable/critique/<YYYY-MM-DD>-<slug>.md` with:

```markdown
# Design review — <target> — <date>

## Verdict: SHIP | FIX FIRST | REDESIGN
Scores (1–10): Design __ · Usability __ · Creativity __ · Content __
(Ship threshold: all ≥ 7 and Usability ≥ 8 — see wedding-site-standards §5)

## Blockers (must fix)
- [source] finding → suggested fix (one line)

## Should fix
## Consider
## What is working (keep)
## Evidence
- screenshots: paths
- detector: N findings (list rule ids)
- axe: N serious/critical
```

Rules for the report:
- Deduplicate: one finding, one line, first source wins.
- Rank by layer, not ease: conceptual/structural before visual before
  polish (design-anti-slop's ordering).
- Quote `DESIGN.md`/`PRODUCT.md` when a finding is a conformance issue.
- End with the single most valuable next command
  (e.g. `/impeccable polish /rsvp`, `hallmark redesign src/pages/index.astro --mood editorial`).

Print the verdict and the blockers in chat; the file holds the rest.
