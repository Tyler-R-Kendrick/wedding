import 'server-only';
import type { CapabilityContext } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { publicPageContext } from '@/domain/content/page-context';
import './admin-content.css';

/**
 * The admin content area renders only for admins holding `admin_content`. This is UX
 * minimisation: every read and write below still goes through `invoke`, which re-checks.
 */
export async function adminContentContext(): Promise<{ principal: Principal; ctx: CapabilityContext; allowed: boolean }> {
  const { principal, ctx } = await publicPageContext();
  const allowed = principal.kind === 'admin' && principal.entitlements.has('admin_content');
  return { principal, ctx, allowed };
}

export function AdminDenied() {
  return (
    <main id="main" className="ac-main">
      <h1>Content</h1>
      <p>Administrator sign-in with content access is required.</p>
    </main>
  );
}
