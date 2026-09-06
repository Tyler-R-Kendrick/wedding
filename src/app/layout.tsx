import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sara + Tyler', template: '%s | Sara + Tyler' },
  description: 'Sara and Tyler are getting married in Chicago on July 17, 2027.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-theme is the hook the design swarm's themes key off; "gilded-hour" is the default.
  return (
    <html lang="en" data-theme="gilded-hour">
      <body>{children}</body>
    </html>
  );
}
