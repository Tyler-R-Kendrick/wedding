import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@wedding/sitemap/stage.css';
import './greybox.css';

export const metadata: Metadata = {
  title: { default: 'Wireframe · Stage 2', template: '%s · Wireframe · Stage 2' },
  description: 'Lo-fi wireframes of every page of Tyler & Sara\'s wedding site.',
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
