import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@wedding/sitemap/stage.css';
import '@wedding/skeleton/skeleton.css';
import './themes/index.css';
import './designs.css';

export const metadata: Metadata = {
  title: { default: 'Placeholder · Stage 4', template: '%s · Placeholder · Stage 4' },
  description: 'Every page of Tyler & Sara\'s wedding site with stand-in content, in each design.',
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
