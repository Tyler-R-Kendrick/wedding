import 'server-only';
import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { ownGuestRecords } from '@/domain/identity/principal';
import type { NavItem } from '@/themes/types';
import { ADMIN_PORTAL, GUEST_PORTAL } from './account';

/** Portal doors listed first in the signed-in account menu on every page. */
export async function accountPortalLinks(db: Db, principal: Principal): Promise<NavItem[]> {
  if (principal.kind === 'anonymous' || principal.kind === 'system') return [];
  if (principal.kind === 'guest') {
    const links: NavItem[] = [GUEST_PORTAL];
    if (principal.viewedBy) links.push(ADMIN_PORTAL);
    return links;
  }
  const links: NavItem[] = [ADMIN_PORTAL];
  const own = await ownGuestRecords(db, principal.authIdentityId);
  if (own.length > 0) links.push(GUEST_PORTAL);
  return links;
}
