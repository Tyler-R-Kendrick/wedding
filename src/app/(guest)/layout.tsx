import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/components/tokens/foundation.css';
import '@/components/rsvp/recipes.css';

export const dynamic = 'force-dynamic';

/**
 * Guest surfaces (Your Weekend, RSVP). Personalized: never cached (force-dynamic => no-store).
 * The shell below is a minimal landmark scaffold; Swarm B's theme Shell/Nav replace it at merge.
 */
export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="page" style={{ paddingBottom: 0 }}>
        <nav aria-label="Primary">
          <ul className="list list--plain" style={{ display: 'flex', gap: 'var(--spacing-lg)', margin: 0 }}>
            <li>
              <Link href="/">Sara + Tyler</Link>
            </li>
            <li>
              <Link href="/your-weekend">Your Weekend</Link>
            </li>
            <li>
              <Link href="/rsvp">RSVP</Link>
            </li>
          </ul>
        </nav>
      </header>
      {children}
      <footer className="page" style={{ paddingTop: 0 }}>
        <p className="card__meta">Sara + Tyler, Saturday, July 17, 2027, Chicago. Questions? TODO(Tyler &amp; Sara): contact details.</p>
      </footer>
    </>
  );
}
