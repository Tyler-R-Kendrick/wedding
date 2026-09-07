import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { preload } from 'react-dom';
import { Placeholder } from '@/components/provenance/Placeholder';
import { DesignSwitcher } from '@/components/switcher/DesignSwitcher';
import { getThemeMeta, listThemes } from '@/themes/registry';
import { PATHNAME_HEADER } from '@/themes/routes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';
import '@/components/rsvp/recipes.css';

export const dynamic = 'force-dynamic';

const THEME_OPTIONS = listThemes().map((t) => ({ id: t.id, name: t.name, tagline: t.tagline }));

export async function generateViewport(): Promise<Viewport> {
  return { width: 'device-width', initialScale: 1, themeColor: getThemeMeta(await getRequestTheme()).themeColor };
}

export async function generateMetadata(): Promise<Metadata> {
  const meta = getThemeMeta(await getRequestTheme());
  return { icons: { icon: [{ url: meta.icon.svg, type: 'image/svg+xml' }], apple: [{ url: meta.icon.apple, sizes: '180x180' }] } };
}

/**
 * Guest surfaces (Your Weekend, RSVP, Transportation, Trip). Personalized: never cached
 * (force-dynamic => no-store).
 *
 * These pages wear the guest's chosen design, exactly as the public tree does: both themes' token
 * blocks already ship in `globals.css` scoped by `[data-theme]`, so setting that attribute here is
 * what makes `recipes.css` resolve its `var(--color-*)` and `var(--type-*)` against the theme.
 *
 * This file previously imported `@/components/tokens/foundation.css` instead. That file describes
 * itself as a level-03 fallback which "the theme engine … supersedes at merge", and DESIGN.md scopes
 * it to admin screens, the dev inbox, error pages, e-mail and print. Left imported it redefined the
 * same token names at `:root` with faces that have no `@font-face` on these routes, so the two most
 * important guest pages rendered entirely in Times New Roman and the design switcher changed nothing
 * about them.
 */
export default async function GuestLayout({ children }: { children: ReactNode }) {
  const theme = await getRequestTheme();
  const currentPath = (await headers()).get(PATHNAME_HEADER) ?? '/';
  // The same nav model the themed shell renders, from the same lifecycle source, so a guest sees one
  // site. The hand-rolled list this replaces held two links — Your Weekend and RSVP — which made
  // /transportation a dead end: from it a guest could reach neither Gifts nor Travel & Stay nor The
  // Wedding, and from /gifts they could not reach /transportation. Hidden UI is never
  // authorization; every route still re-checks entitlements server-side.
  const frame = await buildPageFrame({ theme, currentPath });
  const nav = [...frame.nav.primary, ...frame.nav.more];
  for (const font of getThemeMeta(theme).fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    // `data-theme` is on a server-rendered wrapper, not only mirrored onto <html> by the script
    // below: the theme token blocks are attribute-scoped, so they cascade from any element that
    // carries it. Set by script alone, these pages arrived unthemed with JavaScript disabled and for
    // the first paint before hydration — the review measured Times New Roman in exactly that window.
    // The root layout cannot resolve it instead: reading headers there would make every static
    // public route dynamic.
    // `site` is the same ground class the public shell uses (themes/<id>/kit/index.tsx): it makes
    // this the full-height flex column the header/main/footer expect, paints the themed background,
    // and — the reason it is not optional — `print.css` scopes every one of its rules to `.site`,
    // so without it the guest nav printed on every page.
    <div className="site" data-theme={theme}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      <a className="wp-skip" href="#main">
        Skip to content
      </a>
      <header className="wp-header">
        <p className="wp-brand">
          <Link href="/">{frame.site.coupleDisplayName}</Link>
        </p>
        <nav aria-label="Primary">
          <ul className="wp-nav">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={item.href === currentPath ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* PRODUCT.md › Themes: the switcher is "visible to everyone until a design is chosen". It
            was on every public page and on none of the guest ones, so a guest who followed a link
            from Home into Transportation lost the ability to change design. */}
        {frame.switcherEnabled ? <DesignSwitcher variant="trigger" id="design-switcher-guest" current={theme} themes={THEME_OPTIONS} /> : null}
      </header>
      {children}
      <footer className="wp-footer">
        <p>Sara + Tyler · Saturday, July 17, 2027 · Chicago</p>
        {/* The shared Placeholder names who is still writing, so a gap reads as editorial rather than
            as a bug with `TODO(...)` printed on it. The marker belongs in the content record (content
            backlog), never in what a guest reads. */}
        <Placeholder inline>how to reach us with a question</Placeholder>
      </footer>
    </div>
  );
}
