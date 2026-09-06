# Theme engine, lifecycle, and the public shell (level 04, Swarm B)

One domain, two complete designs (ADR-0009): **Gilded Hour** (Art Deco: one centred axis,
frieze nav, numbered acts, gold geometry) and **Conservatory** (Botanical: left-weighted herbarium
sheet, kraft tag rail, pressed cards, line-art foliage). Routes, data, capabilities, and copy are
theme-agnostic; a theme owns expression only. The lifecycle state machine (ADR-0012) decides what
Home and the navigation do; the theme decides how it looks.

```
request ──proxy.ts──▶ theme = ?theme → cookie → default        preview = ?preview | cookie (shape-checked only)
   │                                                            │
   ├─ static public route (/) ────▶ rewrite /t/<theme>/…        └─▶ rewrite /t/<theme>/preview/<token>/…  (dynamic, no-store)
   └─ every other route ──────────▶ pass through + x-theme / x-lifecycle-preview request headers
                                        │
                        page: data (capabilities / domain) ──▶ getTheme(theme).recipes.<page>(data) ──▶ Shell[data-theme]
```

## Files

| Path | Role |
|---|---|
| `src/themes/types.ts` | `ThemeDefinition`, `ThemeComponentKit` (22 component contracts), `ThemeRecipes`, `PageData` types, `MotionSpec`, `ThemeStructure` |
| `src/themes/registry.ts` | Metadata only (ids, names, fonts, structure, motion). Importable from the proxy and the browser. `DEFAULT_THEME = 'gilded-hour'` |
| `src/themes/resolve.ts` | Pure `resolveTheme({ query, cookie })` → `{ theme, source }`; cookie name/options |
| `src/themes/routes.ts` | `STATIC_PUBLIC_ROUTES` (routes with a `src/app/t/[theme]/…` page), personalized prefixes, header names |
| `src/themes/index.ts` | `getTheme(id)` → full definition with kit + recipes (server / render harness only) |
| `src/themes/server.tsx` | `getRequestTheme()`, `buildPageFrame()`, `renderHome()` (server-only) |
| `src/themes/<id>/DESIGN.md` + `design.json` | Source of truth for tokens (Google DESIGN.md spec) |
| `src/themes/<id>/theme.css` | **Generated** tokens under `[data-theme="<id>"]` (`npm run design:sync`) |
| `src/themes/gilded-hour/tailwind.theme.css` | **Generated** Tailwind v4 `@theme` block (default theme values) |
| `src/themes/<id>/fonts.css` | Hand-written `@font-face` (3 woff2 files per theme + metric-matched local fallbacks) |
| `src/themes/<id>/kit/` | The theme's component expressions (`kit/index.tsx`, `kit/Countdown.tsx`) |
| `src/themes/<id>/kit.css` | The theme's CSS: tokens only, no literals |
| `src/themes/<id>/recipes/` | `home.tsx` (per lifecycle state) + generic recipes from `shared/recipes.tsx` |
| `src/themes/shared/` | Theme-neutral pieces: `home-content.ts` (copy per state), `recipes.tsx` (Story/Archive/Detail/Form/Dashboard/Gallery), `DialogBase.tsx`, `use-countdown.ts`, `ThemeSync.tsx`, `base.css`, `print.css`, icons |
| `src/domain/lifecycle/` | `countdown.ts` (America/Chicago calendar days), `nav.ts` (nav per state), `preview.ts` (signed tokens), `state.ts` (`resolveLifecycle`, gated by `requireAdmin`), `index.ts` (server loader) |
| `src/proxy.ts` | Theme + preview resolution and rewrites (Next.js 16 `proxy` convention lives at `src/proxy.ts`, not inside `app/`) |
| `src/app/t/[theme]/` | Static theme trees: `layout.tsx` (font preload, html mirror), `page.tsx` (Home, `revalidate = 60`), `preview/[token]/page.tsx` (dynamic admin preview) |
| `src/app/(public)/layout.tsx` | Dynamic public routes other swarms add; reads the proxy's `x-theme` |
| `src/components/switcher/` | "Design" control (client; `trigger` in the frieze/rail and footer, `menu` inline in the phone Menu sheet) + server action (cookie via `navigate_to`) |
| `scripts/design-sync.mjs` | Token generator + `--check` drift gate |
| `scripts/render-home.tsx`, `scripts/screenshot-home.mjs`, `scripts/harness-register.mjs` | Review harness: Home × 9 states × 2 themes as static HTML + screenshots at 390/768/1440 (the register hook stubs `server-only`/`next/*`) |
| `scripts/measure-fallbacks.mjs`, `scripts/measure-cls.mjs` | Fallback `size-adjust` tuning at 390; lab CLS/LCP under 4× CPU + 1.6 Mbps |
| `src/themes/<id>/tokens.generated.json` | **Generated** colours (for `themeColor` and anything TypeScript needs from DESIGN.md without a literal) |

## Resolution order and persistence

`?theme=<id>` → `theme` cookie → default (`gilded-hour`, design-doc §11 decision 1). Invalid values
are ignored, never errors. A valid `?theme=` is remembered on the device (one-year, `SameSite=Lax`,
`HttpOnly` cookie set by the proxy) so a shared `?theme=conservatory` link keeps its design on the
next click. The switcher's server action sets the same cookie after validating the id through the
`navigate_to` capability; the client then drops a `?theme=` query (`router.replace(pathname)`,
since the query would win over the cookie) and `router.refresh()` re-runs the proxy. `ThemeSync`
mirrors the new Shell's theme onto `<html>`. The choice is never tied to a
guest identity. Responses carry an `x-theme` header (tests and debugging).

## Static rendering

Each theme is a real route tree under `/t/[theme]` (`generateStaticParams`, `dynamicParams = false`).
The proxy rewrites clean URLs listed in `STATIC_PUBLIC_ROUTES` to `/t/<theme><path>`; guests never
see `/t/`. Home is prerendered per theme and revalidates every 60 s, so a lifecycle publish
propagates within a minute (the client countdown re-computes on mount and at each Chicago
midnight, so a stale-by-minutes page never shows a stale day count). Personalized routes
(`/your-weekend`, `/rsvp`, `/admin`, `/i/…`, `/claim`) and every preview response are
`Cache-Control: private, no-store` (the proxy sets it; Next's dynamic-route default in production
is `private, no-cache, no-store, …` as well).

**Adding a page.** Dynamic: put it under `src/app/(public)/<route>/page.tsx`, fetch theme-agnostic
data, then `const theme = await getRequestTheme(); return getTheme(theme).recipes.detail(data)`
(build the `PageFrame` with `buildPageFrame({ theme, currentPath })`). Static: add
`src/app/t/[theme]/<route>/page.tsx` mirroring `t/[theme]/page.tsx` and append the route to
`STATIC_PUBLIC_ROUTES`. Never import from another theme's directory; never write `new Date()` in
`src/app` or `src/components` (the lifecycle module owns the clock).

## Why `data-theme` is on the Shell, mirrored to `<html>`

The root layout cannot read the theme without opting every route into dynamic rendering, so every
recipe's `Shell` renders `<div class="site" data-theme="<id>">` (present in the SSR HTML, so there is
no flash), the theme layout emits a one-line inline script that mirrors the attribute onto `<html>`
before paint, and `ThemeSync` (client effect) keeps it in sync after `router.refresh()`. Theme CSS is
scoped to `[data-theme="<id>"]`, so it applies from either element.

## Tokens: DESIGN.md → theme.css

`npm run design:sync` regenerates, and `npm run design:sync:check` (part of `npm run verify`) fails
on drift. Per theme it emits, under `[data-theme="<id>"]`:

- colours, spacing, rounded from `npx design.md export --format css-vars`;
- typography from the DESIGN.md front matter: `--font-display`, `--font-text`, `--font-accent`, one
  `--font-<family>` per family, and `--type-<style>-{family,size,weight,line,tracking,features}`;
- motion, shadows, focus and procedural-art URLs from `design.json` `extensions`
  (`--duration-*`, `--ease-*`, `--stagger-*`, `--shadow-*`, `--focus-ring`, `--art-*`).

`globals.css` imports Tailwind, the generated `@theme` (Gilded Hour defaults, so utilities such as
`bg-primary` reference the same variables), both `theme.css` files in `@layer base` (Conservatory's
values override under its attribute), fonts, the shared base, both kits in `@layer components`, and
print. Kits never contain a colour or font literal; the detector (`npx impeccable detect src/`) and
stylelint enforce it. The generated files carry `stylelint-disable`; `src/themes/*/fonts.css` is
waived in `.impeccable/config.json` because the metric-fallback face names ("Cinzel Fallback") are
not DESIGN.md families by design.

## Fonts

Six OFL faces, subset to Latin and converted to woff2 with fontTools (`pyftsubset … --flavor=woff2
--layout-features='*'`), three files per theme in `public/fonts/<theme>/` with each family's
`OFL-<Family>.txt`:

| Theme | Files | Metric fallback (`local()`) |
|---|---|---|
| Gilded Hour | `cinzel-wght` (400–900), `josefin-sans-wght` (100–700), `big-shoulders-display-wght` (100–900) | Times New Roman clone for Cinzel (caps-weighted), Arial clone for Josefin Sans and Big Shoulders |
| Conservatory | `gloock-regular`, `spectral-regular` (400), `spectral-medium` (500; the one file over the three-file target, see DESIGN.md), `cardo-italic` | Times New Roman clone for all |

`size-adjust` / `ascent-override` / `descent-override` were computed with fontTools against
Liberation Serif/Sans (metric clones of Times New Roman/Arial), then `size-adjust` was tuned by
rendering the fold strings at 390 in both faces (`scripts/measure-fallbacks.mjs`; CLS 0.000 under
throttling). Only the active theme's files are preloaded (`ReactDOM.preload` hints from the theme
layout: one `<link rel="preload">` each in production). Spectral italic is not shipped. To refetch the sources:

```bash
base=https://raw.githubusercontent.com/google/fonts/main/ofl
curl -LO $base/cinzel/Cinzel%5Bwght%5D.ttf   # josefinsans/JosefinSans[wght].ttf, bigshouldersdisplay/BigShouldersDisplay[wght].ttf,
                                              # gloock/Gloock-Regular.ttf, spectral/Spectral-Regular.ttf, cardo/Cardo-Italic.ttf, <family>/OFL.txt
pip install fonttools brotli && python3 -m fontTools.subset Cinzel.ttf --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' --layout-features='*' --flavor=woff2 --no-hinting --output-file=public/fonts/gilded-hour/cinzel-wght.woff2
```

## Kits: same contract, different structure

Props, accessible names, focus order and states are identical (`ThemeComponentKit`); markup and CSS
differ. Asserted by `tests/unit/themes/resolve.test.ts` (`ThemeStructure` differs on every axis) and
`tests/ui/home.test.tsx` (no `gh-` class in Conservatory output and vice versa).

| | Gilded Hour | Conservatory |
|---|---|---|
| Shell | marble ground, gold top rule, elevator panel reserved at the bottom on phones | creme sheet: `[rail | page]` grid on desktop; bottom bar only when the state has quick actions |
| Nav | frieze (up to six links mirrored around the S+T plaque in one row, longer states add an architrave line; the Design trigger ends the right side) ≥ 900 px; plaque + Menu dialog (with the Design options) and a fixed four-cell **elevator panel** below | **kraft tag rail** on a thread ≥ 900 px (current tag inverted, tilted 3°, pollen knot); floating Menu tag + two-action bar on phones |
| Hero | monument on the axis: names in Cinzel caps, `07 · 17 · 27`, weekday date, place, a sentence-case status line, lede, countdown, actions; curtain rise (once per session) over a static sunburst | left-weighted names with the “+” drawn in pollen, lede, sky-band countdown, actions; kraft specimen tag with date/place hanging at the right; leaf border on one edge |
| Section | numbered acts (plaque `01`…), chevron rule that draws itself in, centred heading, prose left-aligned in a 42 rem column, grounds marble/creme/lake/ink | washes (creme/moss/sky/ink) with a fern rule growing from the margin; 7/5 grid: text left, one **pressed card** mounted right, tilted ±1–2°, overlapping the wash above |
| Card / Timeline / Stat | polished marble + hairline, stepped gold frame when featured; engraved-tick vertical timeline; numeral plates | ivory sheet with paper shadow, kraft specimen label, pressed-flower silhouette cropped at a corner; winding vine with leaf stops; specimen-label stats |
| Buttons | rectangles, engraved inset hairline; ink / bronze (RSVP) / marble ghost | 8 px corners; moss ink / pollen (RSVP) / ivory ghost |
| Dialog | curtain (clip-path from the top) on the native `<dialog>` | sheet settles (12 px drift) on the native `<dialog>` |

## Home by lifecycle state

`src/themes/shared/home-content.ts` builds one `HomeContent` per state from `SiteFacts`
(seeded from `docs/design/brief.md` §2 through `site_settings`): hero job, primary/secondary action,
optional deadline, countdown visibility, and 4–6 sections. Unknowns are typed placeholders
(`{ todo }`) rendered as visible `TODO(Tyler & Sara)` marks; `tests/unit/themes/home-content.test.ts`
asserts that unsettled facts (rooms, times, dress code, deadline, block, music) never appear as prose.

| State | Home job (design-doc §3) | Primary action | Countdown |
|---|---|---|---|
| TEASER / SAVE_THE_DATE | names, `07 · 17 · 27`, thesis; five acts Adventure · Place · Memory · Hospitality · Future | Our Story / Travel & Stay | yes |
| INVITATIONS_OPEN | claim your invitation; The Wedding digest, travel, transport, story | Claim your invitation | yes |
| RSVP_OPEN | RSVP + deadline placeholder; wedding, travel, transport, gifts (below RSVP), story | RSVP (accent) · Directions | yes |
| RSVP_CLOSED | “see you soon”, logistics digest, your weekend | The Wedding · Directions | yes |
| WEDDING_WEEK | your weekend, Saturday timeline, rides, what’s open, ask | Your Weekend · Directions | yes |
| WEDDING_DAY | title **Today**; now/next timeline (`#now`), your table, ride home, ask, photos | Now · Ask Us | hidden |
| POST_WEDDING | thank you; add your photos; story, adventures, building | Add your photos | hidden |
| ARCHIVE | the weekend preserved | Photos & Video | hidden |

Navigation per state (`navFor`) follows design-doc §3 (≤5 primary on phones, "More" sheet, sticky
actions; "Your invitation" until claimed; Gifts never in primary and never above RSVP).

## Lifecycle preview (admins only)

`?preview=<STATE>` or `?preview=<STATE>.<exp>.<sig>` (or the `lifecycle-preview` cookie with the
signed form) is applied by `resolveLifecycle` **only when `requireAdmin(principal)` passes**; a valid
signature alone grants nothing, and anonymous or guest requests always render the published state.
Admins mint signed tokens through `navigate_to({ route, lifecycle })` (audited as
`lifecycle.previewed`); tokens are HMAC-signed with `CONFIRMATION_SECRET` (no new secret) and expire
after 12 h. Previews render through the dynamic `/t/[theme]/preview/[token]` tree, are visibly
banded ("Previewing RSVP_OPEN (published state: TEASER)"), and are never cached. Because admin
sessions arrive with the auth swarm, the e2e suite covers the negative path (non-admins) and the
integration suite the positive path with a synthetic admin principal.

## Countdown

`daysUntil(now)` compares calendar days in `America/Chicago` (any time on July 17, 2027 in Chicago
is day 0, "Today"); the server renders the initial value, `useCountdown` re-computes on mount and at
the next local midnight. Days only, tabular numerals, a crossfade on change (none under reduced
motion), hidden on WEDDING_DAY and after.

## Motion and reduced motion

One authored moment per page: Gilded Hour's curtain rise + sunburst on Home and the chevron rule
that draws itself in on section entry (scroll-driven `animation-timeline: view()` with a plain
fallback); Conservatory's pressed sheets settling (≤5 staggered 80 ms) and a ≤12 px sky-wash
drift. `prefers-reduced-motion: reduce` (shared `base.css` + per-kit overrides) removes the curtain,
renders cards at rest, disables parallax and shimmer, and limits every transition to opacity/colour
at 120 ms. Route transitions (elevator doors via the View Transitions API) are not implemented at
this level.

## Commands

```bash
npm run design:sync            # regenerate theme.css / tailwind.theme.css from DESIGN.md
npm run design:sync:check      # drift gate (in npm run verify)
node --import ./scripts/harness-register.mjs --import tsx scripts/render-home.tsx && node scripts/screenshot-home.mjs [--reduced]   # review harness
node scripts/measure-fallbacks.mjs; node scripts/measure-cls.mjs http://localhost:3104/?theme=gilded-hour   # font fallback + lab CLS
PORT=3104 npm run dev          # then BASE_URL=http://localhost:3104 npm run test:e2e
NEXT_TURBOPACK_ROOT=/home/user npm run build   # sandboxes whose node_modules is a symlink outside the project
```

## Known gaps

- Elevator-door route transitions are not implemented.
- Spectral italic and Josefin Sans italic are not shipped; Conservatory ships four files (Spectral 500 added after review).
- Admin preview positive path is integration-tested only; the e2e admin journey lands with the auth swarm.
- Placeholder imagery (`ImageFrame`, `Gallery`) is wired but Home has no photography until the couple supplies it.
