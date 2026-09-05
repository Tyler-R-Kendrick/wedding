import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sara + Tyler', template: '%s | Sara + Tyler' },
  description: 'Sara and Tyler are getting married in Chicago on Saturday, July 17, 2027.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout. The theme attribute lives on the Shell wrapper (rendered by every recipe) because
 * the resolved theme is a route param under /t/[theme] or a per-request header, neither of which
 * the root layout can read without opting the whole tree into dynamic rendering. The theme layout
 * mirrors it onto <html> before paint; suppressHydrationWarning covers that attribute.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Persistent polite live region: the design switcher announces a change here, outside the
            themed shell that unmounts and remounts when the design swaps. */}
        <p id="design-announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
        {children}
      </body>
    </html>
  );
}
