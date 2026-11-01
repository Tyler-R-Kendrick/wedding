import { describe, expect, it } from 'vitest';
import { ADMIN_PORTAL, GUEST_PORTAL } from '@/domain/lifecycle/account';
import { accountPortalLinks } from '@/domain/lifecycle/account-portals';
import type { GuestPrincipal } from '@/contracts/principal';

describe('account portal links', () => {
  const db = null as never;

  it('lists Guest Portal for a signed-in guest', async () => {
    const guest = { kind: 'guest' as const, authIdentityId: 'u1' as never, guestId: 'g1' as never, householdId: 'h1' as never, actsFor: ['g1' as never], entitlements: new Set(), authenticatedAt: new Date().toISOString(), sessionId: 's1' } as GuestPrincipal;
    expect(await accountPortalLinks(db, guest)).toEqual([GUEST_PORTAL]);
  });

  it('lists Guest Portal and Admin Portal while previewing a role', async () => {
    const guest = {
      kind: 'guest' as const,
      authIdentityId: 'u1',
      guestId: 'g1',
      householdId: 'h1',
      actsFor: ['g1'],
      entitlements: new Set(),
      authenticatedAt: new Date().toISOString(),
      sessionId: 's1',
      viewedBy: { adminId: 'a1' as never, roles: new Set(['owner']), readOnly: true, previewRole: 'guest' },
    } as unknown as GuestPrincipal;
    expect(await accountPortalLinks(db, guest)).toEqual([GUEST_PORTAL, ADMIN_PORTAL]);
  });
});
