import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/components/tokens/foundation.css';
import '@/components/rsvp/recipes.css';
import { AdminIndex } from './admin/_components/console';
import './admin/_components/ops.css';
import './admin/_components/console.css';

export const dynamic = 'force-dynamic';

/**
 * The admin console shell. Every admin screen hangs off one index (`_components/sections.ts`), so a
 * screen that ships without an entry there is a screen nobody can find — which is exactly how
 * lifecycle, audit, jobs, metrics, flags and providers spent eleven levels having machinery and no
 * door. The full list lives in a closed `<details>`: twenty links open by default would push every
 * page down half a phone screen, and a disclosure needs no JavaScript to be keyboard-complete.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    // `.admin-root` exists to carry the family. `globals.css` sets `html { font-family:
    // var(--font-text) }`, and `--font-text` is defined only under `[data-theme]` — which the admin
    // tree deliberately never carries — so on every admin route that declaration was invalid at
    // computed-value time and `html` fell back to the browser default. `.ops` re-declares the family
    // for the page body, which is why level 14's fix looked complete; the chrome AROUND it did not,
    // and the skip link, the four top-bar links, the "all admin screens" summary and all 21 index
    // links inside it rendered in Times New Roman. Measured, not inferred:
    // `getComputedStyle(document.querySelector('.con-nav__bar a')).fontFamily`.
    <div className="admin-root">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav aria-label="Admin" className="con-nav">
        <ul className="list list--plain con-nav__bar">
          <li>
            <Link href="/admin">Admin</Link>
          </li>
          <li>
            <Link href="/admin/lifecycle">Lifecycle</Link>
          </li>
          <li>
            <Link href="/admin/audit">Audit</Link>
          </li>
          <li>
            <Link href="/admin/jobs">Jobs</Link>
          </li>
        </ul>
        <details>
          <summary>All admin screens</summary>
          <AdminIndex idPrefix="nav" />
        </details>
      </nav>
      {children}
    </div>
  );
}
