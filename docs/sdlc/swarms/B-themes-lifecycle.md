# Swarm B — Theme engine, public shell, lifecycle, home (level 04)

**Ownership:** `src/themes/**` (engine, both kits, recipes, resolve/proxy
logic), `src/app/(public)/**` shell and home only, `src/app/t/[theme]/**` if
used for static rendering, `src/app/proxy.ts`, `src/app/globals.css`,
`src/app/layout.tsx`, `src/components/switcher/**`, `src/domain/lifecycle/**`,
`src/capabilities/site_status.ts` (extend), `src/capabilities/navigate_to.ts`
(extend), `tests/e2e/themes*.spec.ts`, `tests/unit/themes/**`,
`docs/architecture/theme-engine.md`, `docs/design/critiques/` outputs.

**Inputs:** ADR-0009, ADR-0012, `src/themes/gilded-hour/DESIGN.md` +
`design.json`, `src/themes/conservatory/DESIGN.md` + `design.json`,
`docs/design/inspo/*.md`, `public/assets/art/*/manifest.json`,
`docs/design/design-doc.md` §3–§8.

## Deliverables

1. **Theme engine.** `src/themes/types.ts` (`ThemeDefinition`,
   `ThemeComponentKit`, `PageRecipe`, `MotionSpec`), `registry.ts` (both
   themes, default `gilded-hour`), `resolve.ts` (`?theme=` → cookie →
   default; validates against the registry), `tokens/` generated from each
   theme's `DESIGN.md` via `npx design.md export --format css-vars` into
   `src/themes/<id>/theme.css` under `[data-theme="<id>"]`, plus a script
   `npm run design:sync` that regenerates them and fails CI when stale.
   Tailwind: `globals.css` `@theme` holds Gilded Hour defaults; utilities
   reference variables; Conservatory overrides under `@layer base`.
2. **Fonts** self-hosted (OFL; copy the font files into
   `public/fonts/<theme>/` with their license files), `@font-face` in each
   `theme.css`, preload only the active theme's files, ≤3 files per theme,
   metric-matched fallbacks.
3. **Kits** for both themes: Shell, Nav, Footer, Hero, Section,
   SectionHeading, Eyebrow, Prose, Card, ImageFrame, Gallery, Button, Link,
   Divider, Countdown, Timeline, Stat, form primitives, Dialog, Badge,
   MapHandoff, Skeleton. They must be *structurally* different (nav pattern,
   grid logic, ornament, motion), not recolors. Use the procedural art.
4. **Page recipes** for Home in every lifecycle state (TEASER,
   SAVE_THE_DATE, INVITATIONS_OPEN/RSVP_OPEN/RSVP_CLOSED, WEDDING_WEEK,
   WEDDING_DAY "Today", POST_WEDDING/ARCHIVE) and generic recipes other swarms
   compose (`StoryPage`, `ArchivePage`, `DetailPage`, `FormPage`,
   `DashboardPage`, `GalleryPage`) with typed `PageData` props.
5. **Lifecycle domain**: `src/domain/lifecycle` reads the persisted state,
   applies admin preview (signed query for admins only), exposes
   `getLifecycle()`; countdown in America/Chicago with reduced-motion
   behavior; `site_status` capability returns state + theme.
6. **Switcher**: floating "Design" control → server action sets the cookie →
   refresh; hidden when `FLAG_DESIGN_SWITCHER=off`; keyboard accessible.
7. **Static rendering**: `proxy.ts` rewrites public routes to
   `/t/[theme]/…` with `generateStaticParams`; guest/admin routes stay
   dynamic; personalized responses `private, no-store`.
8. **Design review**: run the `design-review` skill on Home for both themes
   at 390/768/1440; fix blockers; commit reports under
   `docs/design/critiques/`. Ship gate: all axes ≥7, Usability ≥8.

## Tests

Theme resolution (query > cookie > default, invalid ignored), no flash
(`data-theme` present in SSR HTML), both themes × 3 viewports: axe no
serious/critical, `npx impeccable detect <url>` clean, landmarks + RSVP CTA
above the fold on 390px, reduced-motion disables non-essential animation,
switcher sets cookie and re-renders, lifecycle preview only for admins.
