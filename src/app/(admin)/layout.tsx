import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/components/tokens/foundation.css';
import '@/components/rsvp/recipes.css';
import { AdminShell } from '@/components/admin/shell/AdminShell';
import { adminPrincipal } from './_shared/admin';
import './admin/_components/ops.css';
import './admin/_components/console.css';

export const dynamic = 'force-dynamic';
/**
 * Every admin route is noindex, whether or not the page sets its own metadata. The root layout's
 * site-wide noindex is a pre-launch setting and will change; this one must not.
 */
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

const ROLE_LABEL = { owner: 'Owner', planner: 'Planner', moderator: 'Moderator' } as const;

/**
 * The admin console's frame (`components/admin/shell`). Every screen hangs off one index
 * (`_components/sections.ts`): the rail lists all of it, the bar names where you are, and the
 * command palette searches it, so a screen that ships without an entry there is a screen nobody
 * can find.
 *
 * Someone who is not an administrator gets no frame at all: each page shows its own sign-in gate,
 * and a rail of twenty-six links around "sign in first" would be a map of a building they cannot
 * enter. `.admin-root` carries the type family for that bare case (`--font-text` is defined only
 * under `[data-theme]`, which the admin tree never carries).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') {
    return (
      <div className="admin-root admin-root--bare">
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </div>
    );
  }
  const role = (['owner', 'planner', 'moderator'] as const).find((r) => principal.roles.has(r));
  return (
    <div className="admin-root">
      <AdminShell role={role ? ROLE_LABEL[role] : 'Admin'}>{children}</AdminShell>
    </div>
  );
}
