import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { getThemeMeta } from '@/themes/registry';
import { getRequestTheme } from '@/themes/server';
import './auth.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export async function generateViewport(): Promise<Viewport> {
  return { width: 'device-width', initialScale: 1, themeColor: getThemeMeta(await getRequestTheme()).themeColor };
}

/**
 * Auth journeys share one narrow, calm shell. Personalized: never cached.
 *
 * The wrapper carries `[data-theme]`, which it did not before, and that is a correctness fix rather
 * than a flourish. `auth.css` reads `var(--font-text, var(--font-body-md))`, and on a route with no
 * `[data-theme]` neither name is defined by a theme: the value came from the Tailwind `@theme`
 * block that `globals.css` imports from the DEFAULT design, so every guest claimed their invitation
 * in Gilded Hour's faces whatever design they had chosen — and those names carry no fallback stack,
 * so a failed webfont dropped the whole journey to the browser default. Under `[data-theme]` the
 * generated `theme.css` supplies both the right family and its metric-matched fallbacks.
 *
 * The claim flow is where a guest arrives from a text message; it is the worst place on the site to
 * look like a different site.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const theme = await getRequestTheme();
  for (const font of getThemeMeta(theme).fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    // Mirrored onto <html> by script so the over-scroll canvas and any portal are themed too; the
    // attribute on this element is what makes the tokens resolve before hydration and with
    // JavaScript off, which is the state levels 14 and 15 both found rendering in a default face.
    <div className="auth-root" data-theme={theme}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      {children}
    </div>
  );
}
