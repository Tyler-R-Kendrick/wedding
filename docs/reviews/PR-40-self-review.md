# PR 40: sitemap → wireframe → skeleton → placeholder → real

The ask: a development flow that starts with a sitemap, then wireframes, then
interactive skeletons (like boneyard), then placeholder content with theme
pickers, then real content. Each step is a dev-deployable project that builds
on the one before it, can be iterated on alone, and passes changes down the
line.

The first push added `stages/` (four npm workspace projects), wired the real
app to the sitemap, and added a chained CI workflow. CI found one broken doc
path, and the second push fixed it. After that, every check was green. This
file records an adversarial read of the whole diff (`origin/main...HEAD`) and
where each finding ended up.

## 1. What a hostile reviewer would say

*"`CLAUDE.md` says packages are fixed, and this adds one."*

It adds `boneyard-js`, and only stage 3 uses it. The ask named boneyard. The
lockfile diff contains only that package, its one dependency
(`@chenglou/pretext`) and the four workspace links. It changes no existing
version.

*"boneyard is meant to capture bones from a rendered page, and this doesn't."*

At stage 3 there is no rendered page to capture. The bones come from
boneyard's own layout engine (`computeLayout`), fed by the wireframe. So a
wireframe change moves the bones on the next build, and there is no capture
step to forget. The `<Skeleton>` component still does the rendering.

*"Stage builds use webpack, but the app is Turbopack."*

Turbopack, run from a workspace package, also compiles the root app's
`src/instrumentation.ts` and `src/proxy.ts`, and fails on their `@/` imports.
This was reproduced before switching. The reason is documented in
`stages/README.md`. The real app still builds with Turbopack, and does so in
CI with its nav reading the sitemap.

*"The real app's nav now depends on a workspace package."*

That is the cascade the ask wanted. It is guarded: `page()` throws at import
time if a nav key leaves the sitemap. `tests/unit/stages/sitemap-routes.test.ts`
fails when `src/app` and the sitemap disagree in either direction.

## 2. Findings and where they went

| Finding | Outcome |
|---|---|
| A malformed URL (`/%E0%A4%A`) crashed `scripts/stages/serve.mjs`: `decodeURIComponent` threw, uncaught. Its `startsWith(root)` check would also have accepted a sibling directory such as `out2`. | Fixed. Paths are parsed through `URL` inside a `try`, containment is checked against `root + path.sep`, and anything malformed or escaping is a 404. Re-probed with malformed, `..`, `%2e%2e` and `..%2f` paths: every one returns 404 and the server stays up. |
| Stage 4 took running text from each design's *primary* role (`--st-ink`), where the designs use `on-surface`. This is latent: the two are the same colour in all three designs today, so nothing rendered wrong. A design that separated them would have set its copy in the wrong colour. | Fixed. Themed text now reads `--color-on-surface`, and `--st-ink` stays for controls. Checked in Chromium: body text computes to Conservatory's `on-surface`. |
| The pre-commit stylelint step only matched `src/**` CSS, so stage CSS was linted in CI but not at commit. | Fixed. `CSS_FILE` now also matches `stages/*/{app,lib}/**`. The generated theme copies are gitignored and never staged. |
| The home lede override read "TODO … until the brief confirms both", which implies the date and venue are undecided. The brief settles both; stage 4 just carries no real content by design. | Fixed. It now says the real values arrive at stage 5. |
| The PR description said 34 pages were drawn. | Corrected. `coverage()` gives 32 drawn (20 draft, 12 in review), 27 derived, 59 in all. |
| An image slot inside a gallery `<button>` renders boneyard's `<div>` bones while unfilled. `<div>` is not phrasing content. | Disclosed, not changed. The divs come from boneyard's `<Skeleton>`. Browsers do not re-parent inside a `<button>`, so there is no hydration mismatch (every stage 3 and 4 page was checked for console errors). axe finds no violations. Filled slots, from stage 4 on, are spans. |
| Deployed stages list every route, admin included, and each page's job. | Disclosed. Admin routes are authorised server-side, not hidden, and every stage page is `noindex`. If the stage deployments should not be public, turn on Vercel Deployment Protection for them. |

## 3. Evidence

- `npm run check`: typecheck, lint, and the unit, UI and stage tests (23 stage tests, plus 8 in `tests/unit/stages/`).
- `npm run quality`, including `design:drift` over `stages/`: 0 anti-patterns, 0 values off the scale.
- `npm run build` of the real app with Turbopack. `npm run stages:build` of all four stages.
- In Chromium, on the static exports:
  - the RSVP flow: an empty submit is blocked, then the status message and the continue link appear;
  - the mobile menu, the arrow-key tabs and the off-site handoff dialog all work;
  - the theme picker's choice survives a reload and a `?theme=` link;
  - no console errors on any page of stages 3 or 4.
- axe, WCAG 2.2 AA, at 390 and 1280 on 12 pages across the four stages: 0 violations.
- CI on a8d75d7 is green on every check. The deployed-preview axe job was skipped, as it is on every PR.
