# Swarm briefs — rules that apply to every feature swarm

Each brief in this directory is a self-contained work order for one parallel
subagent ("swarm") building one level of the stacked-PR ladder described in
[ADR-0010](../../adr/0010-stacked-prs-adversarial-self-review.md). The parent
(integrator) dispatches swarms B–L concurrently from level 03, then merges
them one level at a time in ladder order.

## Environment

- Work only in your assigned git worktree (the parent creates it from the
  level-03 commit and tells you the path). Never touch other worktrees.
- Every Bash call starts with `cd <your worktree> && export -n NODE_OPTIONS;`.
- `node_modules` is already installed at level 03. **Do not add, remove, or
  upgrade packages.** If you truly need one, stop and report it; the parent
  decides.
- Dev server: `PORT=<your port> npm run dev`. Tests: PGlite `memory://`
  (automatic under `NODE_ENV=test`). Playwright uses the preinstalled
  Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run
  `playwright install`.
- Commit early and often inside your worktree with conventional messages
  and the two trailers below. Never push, rebase, amend, or force.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015ZSj3WcgMEVfg4Twn7wLs5
  ```

## Read before writing code

`CLAUDE.md`, `docs/design/brief.md`, `PRODUCT.md`, `docs/design/design-doc.md`,
`docs/architecture/overview.md`, `docs/architecture/capability-layer.md`,
`docs/architecture/providers.md`, `src/contracts/*.ts`, the ADRs your brief
cites, and `.claude/skills/wedding-site-standards/SKILL.md` for anything
guest-facing.

## Non-negotiables

1. **One capability layer.** Every read or mutation the UI, the AI, or WebMCP
   can perform is a `CapabilityDescriptor` registered in
   `src/capabilities/`. Route handlers and server actions call `invoke`;
   they never contain business logic or authorization of their own.
2. **Server-side authorization** via `src/policy` and row-ownership checks in
   handlers. Hidden UI is not authorization. Every new server action or route
   is listed in your report with capability → entitlement → test.
3. **Facts policy.** Wedding facts come only from `docs/design/brief.md`.
   Unknowns are typed placeholders (`placeholder: true`,
   `TODO(Tyler & Sara)`), never plausible fiction. Operational facts carry
   provenance and `verifiedAt`.
4. **Providers stay authoritative.** Money, flights, hotels, rides,
   reservations, gifts: adapters + deep links + honest unavailable states.
   No card data, no scraping, no fabricated success.
5. **Privacy.** Sensitive guest data (dietary, accessibility, addresses,
   biometrics) is minimized, redacted in logs/audit, and never cached across
   identities (`Cache-Control: private, no-store` on personalized responses).
6. **Themes.** Guest-facing UI is built from the theme kit and page recipes
   (`src/themes/*`); pages fetch theme-agnostic data and render
   `theme.recipes[page]`. No raw hex or `font-family` literals; tokens only.
   Mobile (390px) first, WCAG 2.2 AA, 17px body text, visible labels,
   keyboard-complete forms, reduced-motion respected.
7. **Tests are part of the deliverable**: unit + integration (PGlite) for
   domain and capabilities, contract tests for adapters (timeout, 4xx/5xx,
   rate limit, malformed, missing credentials), Playwright for journeys, and
   the security tests your brief names. Never skip or weaken a gate.
8. **Docs are part of the deliverable**: update the architecture doc your
   brief names, `docs/ops/environment.md` for any env var, and add an ADR
   only for a material decision not already covered.

## Definition of done for a swarm

`npm run verify` green in your worktree (typecheck, lint, stylelint, design
lint, detector, unit, integration, build) plus your brief's specific
validations; `npx impeccable detect src/` exit 0 for UI work; a report with:
files/directories touched, capabilities added (name, kind, auth, entitlements,
exposure), env vars, commands run with results, contract changes requested
(never made silently outside your ownership), known gaps, and the
authorization table.
