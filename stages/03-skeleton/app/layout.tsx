import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@wedding/sitemap/stage.css';
import '@wedding/skeleton/skeleton.css';

export const metadata: Metadata = {
  title: { default: 'Skeleton · Stage 3', template: '%s · Skeleton · Stage 3' },
  description: 'Every page of Tyler & Sara\'s wedding site as a clickable skeleton.',
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
