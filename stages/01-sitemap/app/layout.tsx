import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@wedding/sitemap/stage.css';
import './sitemap.css';

export const metadata: Metadata = {
  title: { default: 'Sitemap · Stage 1', template: '%s · Sitemap · Stage 1' },
  description: 'Every page of Tyler & Sara\'s wedding site: who it is for, when it appears, and what it is for.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="st-skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
