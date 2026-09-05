import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/components/tokens/foundation.css';
import '@/components/rsvp/recipes.css';

export const dynamic = 'force-dynamic';

/** Admin surfaces for events, RSVP and seating. Swarm L's console shell replaces this scaffold at merge. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="page page--wide" style={{ paddingBottom: 0 }}>
        <nav aria-label="Admin">
          <ul className="list list--plain" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-lg)', margin: 0 }}>
            <li>
              <Link href="/admin">Admin</Link>
            </li>
            <li>
              <Link href="/admin/events">Events &amp; RSVP window</Link>
            </li>
            <li>
              <Link href="/admin/rsvp">RSVPs</Link>
            </li>
            <li>
              <Link href="/admin/seating">Seating</Link>
            </li>
          </ul>
        </nav>
      </header>
      {children}
    </>
  );
}
