import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { preload } from 'react-dom';
import { getTheme } from '@/themes';
import { getThemeMeta } from '@/themes/registry';
import { PATHNAME_HEADER } from '@/themes/routes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';
import '@/components/rsvp/recipes.css';
import '@/themes/botanical-deco/guest.css';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

/**
 * Every `notFound()` and every unknown URL lands here. Without it Next rendered its bare, unstyled
 * 404 — no navigation, no design, no way back — so a mistyped link from a printed card was a dead end.
 * It sits under the root layout only (not a route group's), so it renders the active design's Shell
 * itself, the way `/credits` does.
 */
export default async function NotFound() {
  const theme = await getRequestTheme();
  const currentPath = (await headers()).get(PATHNAME_HEADER) ?? '/';
  const frame = await buildPageFrame({ theme, currentPath });
  for (const font of getThemeMeta(theme).fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  const Shell = getTheme(theme).kit.Shell;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      <Shell frame={frame}>
        <div className="page">
          <h1 className="page__title">We can’t find that page</h1>
          <p className="page__lede">The link may be old, or mistyped. Everything about the weekend is a step away from the home page.</p>
          <p>
            <Link className="btn btn--primary" href="/">
              Go to the home page
            </Link>
          </p>
          <p>
            <Link className="link-block" href="/ask-us">
              Search the questions guests ask
            </Link>
          </p>
        </div>
      </Shell>
    </>
  );
}
