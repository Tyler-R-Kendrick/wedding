# PR 39: design.md lint and impeccable detect run as a git pre-commit hook

The ask: install, configure and initialise impeccable and Google's `design.md`, and make sure
both run as pre-commit hooks.

Both packages were already dev dependencies (impeccable 4.0.0, `@google/design.md` 0.4.0), and
impeccable was already initialised: `PRODUCT.md`, `DESIGN.md`, `.impeccable/config.json`, and
the PostToolUse/Stop hook in `.claude/settings.json`. Running `init` again would have
overwritten the couple's product context, so it was verified instead, not re-run.

- `impeccable context` loads `PRODUCT.md`.
- `impeccable hooks status` reports the hook enabled.
- All four DESIGN.md files lint at 0 errors and 0 warnings.
- `impeccable detect src/` finds 0 anti-patterns.

What was missing was a git gate. The first push added one. A code review of
`origin/main...HEAD` (high effort) then ran on that push. This file records what it found and
where each finding ended up.

## 1. What a hostile reviewer would say

*"Why not husky and lint-staged?"*

`CLAUDE.md` says packages are fixed, so the gate uses git's own `core.hooksPath`, set by a
`prepare` script. That needs no dependency. lint-staged's main feature, stashing unstaged edits
so tools see the index, is replaced by two narrower mechanisms:

- `design.md lint` reads the staged blob directly.
- Every check that reads the working tree names any file where the working tree differs from
  the index, or blocks when that difference is the whole point of the check (`design:sync`).

*"The hook is stricter than CI."*

In one place, on purpose. `contrast-ratio` warnings block the commit. CI only requires 0 errors,
but `CLAUDE.md` holds the site to WCAG 2.2 AA, and every DESIGN.md sits at 0 warnings today.
The hook keeps it there.

*"`prepare` runs on every install, including Vercel's."*

It exits at once under `CI`, which Vercel and GitHub Actions both set. The PR's own Vercel
preview built green with it in place.

## 2. Findings and where they went

| Finding | Outcome |
|---|---|
| `design:sync --check` read the working tree, so "regenerated but only DESIGN.md staged" passed, and a stale theme.css landed | Fixed. If any file design-sync reads or writes differs from the index, the check refuses to vouch and blocks. Verified with that exact sequence. |
| When the lint process failed to start, `JSON.parse(null)` returned null and `report.summary` threw | Fixed. Tools run as `node <package bin script>`, spawn errors are caught, and a missing report is recorded as "could not run". |
| `.bin` shims can't be spawned portably (they are sh shims on POSIX and `.cmd` on Windows) | Fixed by the same change. `tool()` resolves the script from the package's `bin` field. |
| A DESIGN.md change scanned all of `src/`, including untracked WIP, with no explanation | Fixed. A note names every unstaged or untracked `src/` file the scan read. |
| A DESIGN.md change *replaced* the staged file list with `src/`, dropping staged UI outside it | Fixed. It now scans `src/` plus the staged UI files outside it. Verified with a staged `public/*.html`. |
| The installer overrode a global `core.hooksPath` and bypassed real hooks in `.git/hooks` | Fixed. It leaves both alone and says so. Verified with a global hooksPath and with a git-lfs-style `pre-push`. |
| The failure text recommended `--no-verify`, which the new `CLAUDE.md` rule forbids for UI work | Fixed. The hook, its message and the docs now say: fix the finding, or waive it with a reason. |
| The detector judges the working-copy DESIGN.md, not the staged one | Disclosed, not changed. impeccable has no flag for another design-system file. When they differ, the note names DESIGN.md. |
| The temp dir leaked when `git show` or the lint threw | Fixed. `try/finally`. |
| The drift check fired on the root `DESIGN.md` (which design-sync never reads) and missed lockfile bumps | Fixed. Root DESIGN.md is out, `package-lock.json` is in. |
| SessionStart re-ran the installer silently, undoing a deliberate opt-out | Fixed. `git config hooks.designGate false` is honoured on every run, and the installer's output is no longer discarded. |

## 3. Evidence

Each scenario was run against `.githooks/pre-commit` itself.

**Passes:**
- Nothing staged.
- A theme DESIGN.md with its regenerated outputs staged.
- A prose-only root DESIGN.md edit (about 6s, including the full `src/` scan).

**Blocks:**
- Staged CSS with Inter and a named colour (impeccable and stylelint).
- A `broken-ref` in a staged DESIGN.md whose working copy is clean.
- A theme regenerated with only its DESIGN.md staged.
- A low-contrast `on-primary` (4 AA pairings).
- An untracked `src/*.tsx` with Roboto during a DESIGN.md commit (the note names it).
- A staged `public/*.html` with Inter.

**Installer:**
- Sets `.githooks` on a fresh repo, and is silent when re-run.
- Skips under `CI`, outside a repo, with a global hooksPath, with a real `.git/hooks` hook, and
  when opted out.

The PR's first push passed every CI job: design quality, typecheck/lint/unit/integration/build,
and Playwright smoke.

impeccable was then bumped to 4.1.0 (CLI engine 0.1.5) at Tyler's request, which the `CLAUDE.md`
rule on tool updates asks for.

## 4. Design lint pass on 4.1.0

Tyler asked for every impeccable and design-lint finding to be addressed. On 4.1.0:

- **Source scan:** 0 anti-patterns and 15 advisories, all `design-system-font-size`. Eleven
  were fluid or pixel sizes off the Botanical Deco ramp. They now run between `--type-*` tokens,
  and one new step was added: `display-2xl`, 6rem, for the three theme words. The other four were
  15px placeholder-kit text, now `body-sm` at 17px.
- **Rendered scan:** 17 routes in all three designs at 390, 820, 1280 and 1440px, guest routes
  signed in. Before the fixes it found 45 + 15 + 6 + 5 findings: an overflow at 390px, a 2.6:1
  script line, and line lengths of 89–102 characters. All were fixed at the source. Three
  false positives or design-owned trade-offs remain, each waived for one rule on one page; see
  `docs/design/approved-botanical-deco/detector-waivers.md`.
- **The gate itself:** off-scale sizes, colours and radii were advisory, so nothing ever failed on
  them. `scripts/check-design-drift.mjs` now fails on them in the pre-commit hook, in
  `npm run quality`, and in CI. `npm run slop:detect:rendered` makes the rendered scan one
  command.
