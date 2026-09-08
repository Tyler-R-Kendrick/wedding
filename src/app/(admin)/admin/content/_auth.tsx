import 'server-only';
import type { CapabilityContext } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { publicPageContext } from '@/domain/content/page-context';
import { ConsoleGate } from '../_components/console';

/**
 * The admin content area renders only for admins holding `admin_content`. This is UX
 * minimisation: every read and write below still goes through `invoke`, which re-checks.
 */
export async function adminContentContext(): Promise<{ principal: Principal; ctx: CapabilityContext; allowed: boolean }> {
  const { principal, ctx } = await publicPageContext();
  const allowed = principal.kind === 'admin' && principal.entitlements.has('admin_content');
  return { principal, ctx, allowed };
}

/**
 * The content area had its own sign-in gate, which said "Administrator sign-in with content access
 * is required" under an `<h1>Content</h1>` — a different sentence and a different heading from the
 * one every other admin screen shows. `ConsoleGate` is the console's, and it names the entitlement
 * the same way `Denied` does.
 */
export function AdminDenied() {
  return <ConsoleGate what="Content" />;
}
