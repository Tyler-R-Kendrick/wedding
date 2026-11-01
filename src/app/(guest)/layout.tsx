import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { preload } from 'react-dom';
import { getPrincipal } from '@/lib/principal';
import { getTheme } from '@/themes';
import { getThemeMeta } from '@/themes/registry';
import { PATHNAME_HEADER, PREVIEW_HEADER } from '@/themes/routes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';
import { navFor } from '@/domain/lifecycle';
import { isGuestPortalRoute } from '@/domain/lifecycle/guest-portal';
import '@/components/rsvp/recipes.css';
import '@/themes/botanical-deco/guest.css';

export const dynamic = 'force-dynamic';

export async function generateViewport(): Promise<Viewport> {
  return { width: 'device-width', initialScale: 1, themeColor: getThemeMeta(await getRequestTheme()).themeColor };
}

export async function generateMetadata(): Promise<Metadata> {
  const meta = getThemeMeta(await getRequestTheme());
  return { icons: { icon: [{ url: meta.icon.svg, type: 'image/svg+xml' }], apple: [{ url: meta.icon.apple, sizes: '180x180' }] } };
}

/**
 * Guest surfaces (Your Weekend, RSVP, Transportation, Trip, the media pages). Personalized: never
 * cached (force-dynamic => no-store).
 *
 * **The shell is the design's own** (`themes/<id>/kit` → `Shell`), not a hand-rolled header and
 * footer beside it. Carried design debt since level 09: these routes wore `[data-theme]` and the
 * theme's colours and faces, but the chrome around them was `wp-header` / `wp-footer` from the
 * guest kit — one nav list, one line of footer text, no ornament, no bottom bar, no printed
 * directions. It cost Conservatory more than Gilded Hour, because Conservatory's identity is
 * ornament: the sheet, the fern rules, the kraft tags and the pressed-card footer all live in
 * `Shell`, so a guest who followed a link from Home into /transportation arrived at what looked
 * like a different site. Now `/rsvp`, `/your-weekend`, `/transportation`, `/trip` and the media
 * pages are inside the same `Shell` as `/`, `/travel` and `/gifts`, and the design switcher, the
 * elevator panel and the print URLs come with it.
 *
 * `Shell` renders `<main id="main">`, so the pages under it render a plain `<div className="page">`
 * — one `main` per document, which `tests/e2e` and axe both check. The guest-portal content
 * pages (`/guests/travel`, `/guests/things-to-do`, `/guests/things-to-do/[slug]`, `/guests/ask-us`)
 * are the public recipes re-exported, and those recipes already render that Shell. Wrapping them
 * again produced a second header, a second `main`, and a second view-as band. `/guests` itself
 * does not bring a Shell, so it still gets this one.
 *
 * The principal is resolved here so the frame knows whether the reader is signed in: the account
 * menu then opens on the household's pages at first paint, rather than showing "Sign in" to a
 * guest on the very routes a guest reaches by being signed in.
 */
export default async function GuestLayout({ children }: { children: ReactNode }) {
  const theme = await getRequestTheme();
  const h = await headers();
  const currentPath = h.get(PATHNAME_HEADER) ?? '/';
  for (const font of getThemeMeta(theme).fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  // These routes render the public page recipe, which already includes the theme Shell.
  if (isSelfShelledPortalPage(currentPath)) return children;
  const preview = h.get(PREVIEW_HEADER);
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  const frame = await buildPageFrame({
    theme,
    currentPath,
    lifecycle: { principal, ...(preview ? { preview: { value: preview, source: 'query' as const } } : {}) },
  });
  const nav =
    principal.kind === 'guest'
      ? { ...navFor(frame.lifecycle.state, { signedIn: true, currentPath, venue: frame.site.venue, ...(principal.viewedBy ? { viewing: true } : {}) }), portals: frame.nav.portals }
      : frame.nav;
  const Shell = getTheme(theme).kit.Shell;
  return <Shell frame={{ ...frame, nav }}>{children}</Shell>;
}

/** Portal content pages whose recipe already renders `Shell`. `/guests` does not. */
function isSelfShelledPortalPage(pathname: string): boolean {
  if (!isGuestPortalRoute(pathname) || pathname === '/guests') return false;
  return /^\/guests\/(?:travel|ask-us|things-to-do)(?:\/|$)/.test(pathname);
}
