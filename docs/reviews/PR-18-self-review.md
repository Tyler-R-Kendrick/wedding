# PR 18 — level 14: admin operations

**Branch** `claude/wedding-14-admin-ops` · **Base** `main` @ `310926e` (level 13)
**Diff** 45 files, ~+4,390 / −98

The six cross-cutting screens no feature level owned: lifecycle, audit, jobs, metrics, providers,
flags. Eleven capabilities behind them, no new tables, no migration.

## 1. What a hostile reviewer would say

**"The whole console was rendering in Roboto and Arial and every gate said it was fine."** True, and
it is the most important thing in this diff. `ops.css` set `font-family: var(--font-sans)` and
`var(--font-display, …)` — **neither property is defined anywhere in `src/`** — so both fell through
to Tailwind's default stack: `-apple-system, …, Roboto, "Helvetica Neue", …, Arial`. Three of those
are banned by name in `CLAUDE.md`. `npm run lint:css` was green throughout, because stylelint matches
literal `font-family` values and cannot see through a `var()` that resolves to one. So did
`design:lint`, `slop:detect`, and axe. The independent design review caught it by asking the browser
what it had actually computed, which is the only question that would have.

I re-measured it myself before and after:
`getComputedStyle(document.querySelector('.ops')).fontFamily` → `-apple-system, …Roboto…Arial…`
before, `Newsreader` after; the `h1` → `"Libre Caslon Display"`.

**"You shipped an off-switch for a legal gate that nobody could reach."** Also true, and worse than
it sounds. The two BIPA/media-rights gates were rows in a seven-column table with "Switch off" as
column 7. Measured: the button's right edge sat **881px past the container at 390px** and — because
`.ops` caps at `72rem` — still **47px past it at 1440**. There was no viewport at which an operator
could see the control, and "In effect", the only column that answers *is this gate open right now*,
was off-screen at 390 too. They are panels now: `fullyVisible: true` at both widths, with 220px and
1162px of headroom.

**"Two buttons governing two different legal gates were both called 'Switch off'."** Yes — no
`aria-label`, no `aria-describedby`, and `<th scope="row">` is not announced in focus order, so the
one irreversible-feeling control on the screen was the one you could not tell apart. Now
`Switch BIOMETRICS_ENABLED readiness off` and `Switch PRO_MEDIA_AI_PROCESSING readiness off`.

## 2. Authorization

Eleven capabilities, all `auth: 'admin'`, all `exposure: { ui: true, ai: false, webmcp: false }` —
an operations console is not an agent surface, and level 13's derivation guard would have failed the
build had any of them been `ai: true, webmcp: false`.

`admin_integrations` was added to `ADMIN_DEFAULT_ENTITLEMENTS`. That is the fourth level running
where a new entitlement had to be registered or the default test admin 403s on its first real run
while the spec quietly asserts the signed-out page — the list mirrors what the `owner` role already
carries in production, so it stays a mirror rather than a superset.

**The readiness gates.** There is deliberately **no capability that turns a readiness switch on**,
which is a departure from what I asked the swarm to build, and it was right to refuse. I verified the
property myself rather than take it: `setReadiness(…, ready: true)` has **exactly one caller** in
`src/`, `admin_enable_biometric_readiness.ts`, which hard-codes `flag: 'BIOMETRICS_ENABLED'` and
requires a counsel reference — so `PRO_MEDIA_AI_PROCESSING` readiness cannot be opened through the
app at all, and a generic enabler would have destroyed that. The new switch is an unconditional
**off**, gated on `admin_lifecycle` while the biometrics one needs `admin_ai`: a planner can close a
legal gate without being able to open it or use the feature. Closing a gate must never depend on
owning it.

## 3. Secrets and PII

**The write-side audit redaction had a real gap, and it was found by a test written to prove
something else.** `REDACT_KEYS` was anchored: `/^(otp|code|…|email|phone|address)/i`. So `email` was
redacted and `guestEmail` was not — the value would land in `audit_events` verbatim. Nothing writes
such a key today, which is why nothing leaked, but the write pass is the one that matters: it is
destructive, and what it does not redact stays in the table for psql and for exports long after the
request is gone.

Fixed once, in the contract: the word list, the camelCase splitter and the boolean/enum rules now
live in `src/contracts/audit.ts`, and the console's read side imports them instead of keeping a
parallel copy. Two copies of a security list drift, and the copy that drifts is the one nobody is
watching. Mutation-verified against the anchored pattern:
`expected 'chidi@example.test' to be '[redacted]'`.

The boolean rule is what makes tightening safe — `includeNeeds` and `viaToken` sit under sensitive
words but carry one bit each, so they stay readable — and `errorCode` is exempt by name because it is
a closed enum and the single most useful field on a failed row.

The independent review attacked the audit screen directly for PII and could not break it: rendered
rows are `kind=read · surface=ui · durationMs=17`, principals reduce to opaque ULIDs, OTP targets are
hashed, free text is withheld entirely, values cap at 120 chars and keys at 24.

## 4. Tests

**614 unit/UI, 307 integration** (baseline 597 / 262). New e2e spec `tests/e2e/admin-console.spec.ts`,
registered in `TEST_SERVER_SPECS`; `check-spec-coverage` and `check-vitest-coverage` both pass.

**Three assertions changed deliberately, and one of them is the most interesting thing here.**

1. `admin-console.spec.ts` asserted `getByRole('button', { name: 'Switch off' })` had count 2 — which
   passed only while both buttons shared one accessible name, i.e. it pinned the defect. It now
   asserts each flag's own label, which is strictly stronger and fails if they are ever collapsed.
2. **My own fix then broke that spec's security assertion, and the spec was right.** It checks that
   no control on the page can turn a gate on, matching `/enable/i` — and my new label
   `Switch BIOMETRICS_ENABLED readiness off` **contains the substring ENABLED**. A correct off-switch
   read as an enable control. The negative match is on word boundaries now (`_` is a word character,
   so there is no boundary inside `BIOMETRICS_ENABLED`), with a positive assertion that every control
   in the gates list ends in `readiness off` — immune to flag naming altogether. Sanity-checked both
   directions: the pattern rejects the flag name and still catches `Enable face matching`.
3. I briefly added `/\bopen\b/i` to that same negative list on my own initiative. It matched the dev
   server's `"Open Next.js Dev Tools"` overlay button and failed three projects. Removed: it was
   scope creep, and it was testing the framework rather than the page.

**Written to fail first, and watched to:** the write-side redaction tests (above); the swarm's
`ops-flags` test that there is exactly one `ready: true` caller (flipped its own flag, saw
`+ "src/capabilities/ops/admin_flags.ts"`); and its audit-redaction test, which failed on its first
run and is what exposed the anchoring gap.

**One flake fixed rather than tolerated.** `webmcp.spec.ts:351` failed twice across unrelated trees
with `read ECONNRESET` on a manifest GET — never a server error, never on retry. `manifestFor` now
retries **only** on a transport-level failure; a wrong status or a false `ok` is never retried,
because that is the thing the test exists to catch.

## 5. Threat model

Touches audit (read surface), lifecycle publication, and the two legal gates. No new table, no new
external call, no new secret. The gates stay shut and, for `PRO_MEDIA_AI_PROCESSING`, unopenable.

## 6. Design verdict

Independent `design-reviewer` round on all seven screens, authenticated: **FIX FIRST**, console
average 6/6/6/8, `/admin/flags` worst at 5/4/7/9. Seven blockers, **all seven closed and each
re-measured by me with my own probe**:

| | Blocker | Before → after, measured |
|---|---|---|
| B1 | Console renders in banned fonts | `Roboto…Arial` → `Newsreader` / `"Libre Caslon Display"` |
| B2 | Legal-gate off-switch never fully visible | overflow +881px @390, +47px @1440 → `fullyVisible: true`, −220px / −1162px |
| B3 | Both gate buttons named "Switch off"; `good` tone meant on *and* off | distinct per-flag labels; `good` now means only "on" |
| B4 | Inline links pixel-identical to prose (WCAG 1.4.1 F73) | `decoration: none` → `underline` |
| B5 | `.ops-notice-ok` emitted by two components, styled by none | now distinct border and ground from a plain note |
| B6 | Body/table text 15.94px against a 17px floor | → 18.06px |
| B7 | Metrics window switcher unidentifiable, no selected state | 20×20 plain text → 47×47 bordered control, selected state at weight 600 |

Not theme-aware, confirmed (`data-theme` is null under both `?theme=` values), so this is one design.
axe: 0 WCAG 2.2 A/AA violations across 7 routes × 2 viewports.

**Should-fix items I did not take**, and who owns them: the reviewer's list of console-wide polish —
`.con-stat` label misalignment on a wrapped row, raw UTC timestamps with milliseconds on an
America/Chicago deployment, a `console.css` comment that overclaims 24×24 targets, `DataTable`
announcing its name twice, empty tables rendering a focusable scroll region, and `/admin/audit` at
390 being 25 undifferentiated rows. None is a correctness or safety defect; all are real. **Level 16
(quality)** already owns the carried design debt and owns these too.

## 7. Accessibility and performance

axe clean as above. Real `<table>`s with `tabular-nums`, `<th scope>`, `<caption>`, per-table scroll
containers; `document.scrollWidth === clientWidth === 390` on all seven screens, so the page never
scrolls sideways. No transitions or animations anywhere in the admin scope. No new dependency, no
new route in the public bundle.

## 8. Docs

None added. `docs/architecture/overview.md` and `capability-layer.md` each want a paragraph on the
console; that belongs with **level 17 (docs and release evidence)**, which is where the consolidated
pass happens, rather than as a stub here.

## 9. `TODO(Tyler & Sara)` inventory

**121 in `src/`** at this head, against **122** measured the same way at the level-13 head
`310926e` — a delta of one, incidental. Of those, **65 are in `.ts`/`.tsx`** across 43 files; the
rest are in seed content and CSS.

I give both numbers because level 13's self-review reported "124 in `src/`" and I could not
reproduce that figure at its own head: the same command returns 122 there. The difference is small
and nothing followed from it either way, but a document whose point is that its numbers can be
trusted should say which command produced them. Mine is
`grep -rc "TODO(Tyler" src/ | awk -F: '{s+=$2} END {print s}'`.

Level 14 neither adds nor removes markers by design — it renders no guest content and authors no
copy. The couple-facing list is `docs/content/for-sara-and-tyler.md`, merged at PR #17.

## 10. Verdict

**Ready to merge.** `npm run verify` exit 0 — typecheck, eslint (0 errors, 7 pre-existing `<img>`
warnings from levels 10–11), stylelint, three DESIGN.md files at 0 errors, design sync,
`impeccable detect .`, 614 unit/UI, 307 integration, evals, `next build`. Both Playwright
arrangements green on servers this run started: **166 passed / 47 skipped** test-server, **229 passed
/ 86 skipped** production, 0 flaky in both. `db:generate` reports no schema change, twice; main stays
at migration `0009`.

**The worst true thing about this diff** is that a console rendering entirely in banned fonts passed
every automated gate the repo has — stylelint, the design linter, the anti-slop detector and axe —
and was caught only because a reviewer asked the browser what it had computed rather than what the
CSS said. `var()` indirection is a hole in the linting story, not a one-off mistake, and every level
after this one inherits it until something checks resolved values. That belongs to level 16.
