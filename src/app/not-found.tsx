import type { Metadata } from 'next';
import Link from 'next/link';
import { throughSignIn } from '@/domain/lifecycle/account';
import { preload } from 'react-dom';
import { getTheme } from '@/themes';
import { DEFAULT_THEME, getThemeMeta } from '@/themes/registry';
import { buildPageFrame } from '@/themes/server';
import '@/components/rsvp/recipes.css';
import '@/themes/botanical-deco/guest.css';

/** A path no navigation item has, so none is lit. */
const NOWHERE = '/404';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

/**
 * Every `notFound()` and every unknown URL lands here. Without it Next rendered its bare, unstyled
 * 404 — no navigation, no design, no way back — so a mistyped link from a printed card was a dead end.
 * It sits under the root layout only (not a route group's), so it renders the active design's Shell
 * itself, the way `/credits` does.
 *
 * It reads nothing from the request. Next renders this boundary into every page's tree, so a
 * `headers()` here made every route in the app dynamic, the prerendered public pages included. The
 * frame names no reader (the account menu asks in the browser, as before) and no page in the
 * navigation is marked as the current one: an address that is not a page is none of them.
 */
export default async function NotFound() {
  const theme = DEFAULT_THEME;
  const frame = await buildPageFrame({ theme, currentPath: NOWHERE });
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
            <Link className="link-block" href={throughSignIn('/guests/ask-us')}>
              Search the questions guests ask
            </Link>
          </p>
        </div>
      </Shell>
    </>
  );
}
