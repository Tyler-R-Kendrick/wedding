# Theme engine, lifecycle, and the public shell (level 04, Swarm B)

One domain, one design: **Botanical Deco** (`botanical-deco`), the synthesis Sara and Tyler
approved (`docs/design/approved-botanical-deco/`). The engine was built for two switchable designs
(ADR-0009), Gilded Hour and Conservatory; both were retired and their code, fonts and art removed.
The seams stay, with one theme behind them: the registry, the kit and recipe contracts, the
`/t/[theme]` tree and `?theme=` parsing. Routes, data, capabilities, and copy are theme-agnostic;
the theme owns expression only. The lifecycle state machine (ADR-0012) decides what Home and the
navigation do; the theme decides how it looks.

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
| `src/themes/types.ts` | `ThemeDefinition`, `ThemeComponentKit` (22 component contracts), `ThemeRecipes`, `PageData` types |
| `src/themes/registry.ts` | Metadata only (id, name, fonts, icon, theme colour). Importable from the proxy and the browser. `DEFAULT_THEME = 'botanical-deco'` |
| `src/themes/resolve.ts` | Pure `resolveTheme({ query, cookie })` → `{ theme, source, stale? }`; cookie name/options |
| `src/themes/routes.ts` | `STATIC_PUBLIC_ROUTES` (routes with a `src/app/t/[theme]/…` page), personalized prefixes, header names |
| `src/themes/index.ts` | `getTheme(id)` → full definition with kit + recipes (server / render harness only) |
| `src/themes/server.tsx` | `getRequestTheme()`, `buildPageFrame()`, `renderHome()` (server-only) |
| `src/themes/<id>/DESIGN.md` + `design.json` | Source of truth for tokens (Google DESIGN.md spec) |
| `src/themes/<id>/theme.css` | **Generated** tokens under `[data-theme="<id>"]` (`npm run design:sync`) |
| `src/themes/botanical-deco/tailwind.theme.css` | **Generated** Tailwind v4 `@theme` block: what an element outside `[data-theme]` resolves a token to |
| `src/themes/<id>/fonts.css` | `@font-face` rules: the block between the GENERATED markers is written by `scripts/fonts/subset.py`, the metric-matched local fallbacks by hand |
| `src/themes/<id>/kit/` | The theme's component expressions (`kit/index.tsx`, `kit/Countdown.tsx`) |
| `src/themes/<id>/kit.css` | The theme's CSS: tokens only, no literals |
| `src/themes/<id>/recipes/` | `home.tsx` (per lifecycle state) + generic recipes from `shared/recipes.tsx` |
| `src/themes/shared/` | Theme-neutral pieces: `home-content.ts` (copy per state), `recipes.tsx` (Story/Archive/Detail/Form/Dashboard/Gallery), `DialogBase.tsx`, `use-countdown.ts`, `ThemeSync.tsx`, `base.css`, `print.css`, icons |
| `src/domain/lifecycle/` | `countdown.ts` (America/Chicago calendar days), `nav.ts` (nav per state), `preview.ts` (signed tokens), `state.ts` (`resolveLifecycle`, gated by `requireAdmin`), `index.ts` (server loader) |
| `src/proxy.ts` | Theme + preview resolution and rewrites (Next.js 16 `proxy` convention lives at `src/proxy.ts`, not inside `app/`) |
| `src/app/t/[theme]/` | Static theme trees: `layout.tsx` (font preload, html mirror), `page.tsx` (Home, `revalidate = 60`), `preview/[token]/page.tsx` (dynamic admin preview) |
| `src/app/(public)/layout.tsx` | Dynamic public routes other swarms add; reads the proxy's `x-theme` |
| `scripts/design-sync.mjs` | Token generator + `--check` drift gate |
| `scripts/render-home.tsx`, `scripts/screenshot-home.mjs`, `scripts/harness-register.mjs` | Review harness: Home × 9 states as static HTML + screenshots at 390/768/1440 (the register hook stubs `server-only`/`next/*`) |
| `scripts/measure-cls.mjs` | Lab CLS/LCP under 4× CPU + 1.6 Mbps |
| `src/themes/<id>/tokens.generated.json` | **Generated** colours (for `themeColor` and anything TypeScript needs from DESIGN.md without a literal) |

## Resolution order and persistence

`?theme=<id>` → `theme` cookie → default (`botanical-deco`). There is one design, so every request
resolves to it; invalid values are ignored, never errors. A valid `?theme=` is remembered on the
device (one-year, `SameSite=Lax`, `HttpOnly` cookie set by the proxy, stored as `v2.<id>`). A
request that names a retired design still renders the site: `?theme=gilded-hour` is ignored like
any unknown value, and a stored cookie that names one (bare, as the old design switcher wrote it,
or `v2.<id>`) is reported `stale` by `resolveTheme` and deleted by the proxy. The choice is never
tied to a guest identity. Responses carry an `x-theme` header (tests and debugging).

## Static rendering

The theme is a real route tree under `/t/[theme]` (`generateStaticParams`, `dynamicParams = false`).
The proxy rewrites clean URLs listed in `STATIC_PUBLIC_ROUTES` to `/t/<theme><path>`; guests never
see `/t/`. Home is prerendered and revalidates every 60 s, so a lifecycle publish
propagates within a minute (the client countdown re-computes on mount and at each Chicago
midnight, so a stale-by-minutes page never shows a stale day count). Personalized routes
(`/your-weekend`, `/rsvp`, `/admin`, `/i/…`, `/claim`) and every preview response are
`Cache-Control: private, no-store` (the proxy sets it; Next's dynamic-route default in production
is `private, no-cache, no-store, …` as well).

**Adding a page.** Dynamic: put it under `src/app/(public)/<route>/page.tsx`, fetch theme-agnostic
data, then `const theme = await getRequestTheme(); return getTheme(theme).recipes.detail(data)`
(build the `PageFrame` with `buildPageFrame({ theme, currentPath })`). Static: add
`src/app/t/[theme]/<route>/page.tsx` mirroring `t/[theme]/page.tsx` and append the route to
`STATIC_PUBLIC_ROUTES`. Never write `new Date()` in
`src/app` or `src/components` (the lifecycle module owns the clock).

## Why `data-theme` is on the Shell, mirrored to `<html>`

The root layout cannot read the theme without opting every route into dynamic rendering, so every
recipe's `Shell` renders `<div class="site" data-theme="<id>">` (present in the SSR HTML, so there is
no flash), the theme layout emits a one-line inline script that mirrors the attribute onto `<html>`
before paint, and `ThemeSync` (client effect) keeps it in sync after client navigations. Theme CSS is
scoped to `[data-theme="<id>"]`, so it applies from either element.

## Tokens: DESIGN.md → theme.css

`npm run design:sync` regenerates, and `npm run design:sync:check` (part of `npm run verify`) fails
on drift. It emits, under `[data-theme="<id>"]`:

- colours, spacing, rounded from `npx design.md export --format css-vars`;
- typography from the DESIGN.md front matter: `--font-display`, `--font-text`, `--font-accent`, one
  `--font-<family>` per family, and `--type-<style>-{family,size,weight,line,tracking,features}`;
- motion, shadows, focus and procedural-art URLs from `design.json` `extensions`
  (`--duration-*`, `--ease-*`, `--stagger-*`, `--shadow-*`, `--focus-ring`, `--art-*`).

`globals.css` imports Tailwind, the generated `@theme` (so utilities such as `bg-primary` reference
the same variables), `theme.css` in `@layer base`, fonts, the shared base, the kit in
`@layer components`, and print. The kit never contains a colour or font literal; the detector
(`npx impeccable detect src/`) and stylelint enforce it. The generated files carry
`stylelint-disable`; `src/themes/*/fonts.css` is waived in `.impeccable/config.json` because the
metric-fallback face names ("Bodoni Moda Fallback") are not DESIGN.md families by design.

## Fonts

Bodoni Moda, Newsreader and Ms Madi (OFL), each cut into a preloaded core file and an on-demand
extended file under `public/fonts/botanical-deco/`, with each family's licence beside them. How
they are made, what each face is cut down to and when to rerun it: `scripts/fonts/README.md`. Only
the two roman core files are preloaded (`ReactDOM.preload` hints from the layouts).

## The kit contract

Props, accessible names, focus order and states are the contract (`ThemeComponentKit`); markup and
CSS are the theme's own (`src/themes/botanical-deco/kit/`, class prefix `bd-`). A second design
would be a new folder behind the same contract, a registry entry and its imports in `globals.css`.

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

Motion is the kit's own (`kit.css`, `ride.css`) and is described in the theme's DESIGN.md.
`prefers-reduced-motion: reduce` (shared `base.css` + the kit's overrides) removes scale, translate
and drawing, and limits every transition to opacity/colour at 120 ms.

## Commands

```bash
npm run design:sync            # regenerate theme.css / tailwind.theme.css from DESIGN.md
npm run design:sync:check      # drift gate (in npm run verify)
node --import ./scripts/harness-register.mjs --import tsx scripts/render-home.tsx && node scripts/screenshot-home.mjs [--reduced]   # review harness
node scripts/measure-cls.mjs http://localhost:3000/   # lab CLS
PORT=3104 npm run dev          # then BASE_URL=http://localhost:3104 npm run test:e2e
NEXT_TURBOPACK_ROOT=/home/user npm run build   # sandboxes whose node_modules is a symlink outside the project
```

## Known gaps

- Elevator-door route transitions are not implemented.
- Admin preview positive path is integration-tested only; the e2e admin journey lands with the auth swarm.
- Placeholder imagery (`ImageFrame`, `Gallery`) is wired but Home has no photography until the couple supplies it.
