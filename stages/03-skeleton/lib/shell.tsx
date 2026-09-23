'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { href, navLabel, navPages } from '@wedding/sitemap';
import { Text } from './content';

/**
 * The site's chrome at skeleton fidelity: the navigation is the sitemap's (labels and order), the
 * menu opens and closes on a phone, and the brand and footer are content slots.
 */
export function SiteShell({ current, children }: { current: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="st-site">
      <header className="st-header">
        <Link className="st-brand" href="/" aria-label="Home">
          <Text block="site" part="name" label="Site name" lines={1} as="span" />
        </Link>
        <button type="button" className="st-menu-toggle st-button" aria-expanded={open} aria-controls="st-nav" onClick={() => setOpen(!open)}>
          Menu
        </button>
        <nav id="st-nav" aria-label="Site" className="st-nav" data-open={open || undefined}>
          <ul>
            {navPages().map((p) => (
              <li key={p.id}>
                <Link href={href(p)} aria-current={p.id === current ? 'page' : undefined} onClick={() => setOpen(false)}>
                  {navLabel(p)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
      <footer className="st-footer">
        <Text block="site" part="footer" label="Footer" lines={2} />
      </footer>
    </div>
  );
}
