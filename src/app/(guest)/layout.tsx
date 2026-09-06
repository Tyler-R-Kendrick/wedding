import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { preload } from 'react-dom';
import { Placeholder } from '@/components/provenance/Placeholder';
import { getThemeMeta } from '@/themes/registry';
import { getRequestTheme } from '@/themes/server';
import '@/components/rsvp/recipes.css';

export const dynamic = 'force-dynamic';

export async function generateViewport(): Promise<Viewport> {
  return { width: 'device-width', initialScale: 1, themeColor: getThemeMeta(await getRequestTheme()).themeColor };
}

export async function generateMetadata(): Promise<Metadata> {
  const meta = getThemeMeta(await getRequestTheme());
  return { icons: { icon: [{ url: meta.icon.svg, type: 'image/svg+xml' }], apple: [{ url: meta.icon.apple, sizes: '180x180' }] } };
}

/**
 * Guest surfaces (Your Weekend, RSVP). Personalized: never cached (force-dynamic => no-store).
 *
 * These pages wear the guest's chosen design, exactly as the public tree does: both themes' token
 * blocks already ship in `globals.css` scoped by `[data-theme]`, so setting that attribute here is
 * what makes `recipes.css` resolve its `var(--color-*)` and `var(--font-*)` against the theme.
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
  for (const font of getThemeMeta(theme).fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    // `data-theme` is on a server-rendered wrapper, not only mirrored onto <html> by the script
    // below: the theme token blocks are attribute-scoped, so they cascade from any element that
    // carries it. Set by script alone, these pages arrived unthemed with JavaScript disabled and for
    // the first paint before hydration — the review measured Times New Roman in exactly that window.
    // The root layout cannot resolve it instead: reading headers there would make every static
    // public route dynamic.
    <div data-theme={theme}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      <a className="wp-skip" href="#main">
        Skip to content
      </a>
      <header className="wp-header">
        <p className="wp-brand">
          <Link href="/">Sara + Tyler</Link>
        </p>
        <nav aria-label="Primary">
          <ul className="wp-nav">
            <li>
              <Link href="/your-weekend">Your Weekend</Link>
            </li>
            <li>
              <Link href="/rsvp">RSVP</Link>
            </li>
          </ul>
        </nav>
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
