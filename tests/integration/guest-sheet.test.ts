import { afterEach, describe, expect, it } from 'vitest';
import { adminGuestSheet } from '@/capabilities/admin_guest_sheet';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { setProviderOverride } from '@/providers/registry';
import { MockGuestSheet, UnconfiguredGuestSheet } from '@/providers/guest-sheet';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_guest_ops']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-SHEET' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'sheet-session',
});

describe('admin_guest_sheet', () => {
  afterEach(() => setProviderOverride('guest-sheet', undefined));

  it('is for administrators with guest operations only', async () => {
    expect(expectErr(await run(adminGuestSheet, admin(['admin_content']), {})).code).toBe('forbidden');
    expect(['forbidden', 'unauthenticated']).toContain(expectErr(await run(adminGuestSheet, { kind: 'anonymous' } as Principal, {})).code);
  });

  it('is never offered to the concierge or WebMCP', () => {
    expect(adminGuestSheet.exposure).toEqual({ ui: true, ai: false, webmcp: false });
  });

  it('returns the sheet lines with totals', async () => {
    setProviderOverride('guest-sheet', new MockGuestSheet());
    const d = expectOk(await run(adminGuestSheet, admin(), {})).data;
    expect(d.sample).toBe(true);
    expect(d.rows).toHaveLength(3);
    expect(d.totals).toMatchObject({ households: 3, adults: 5, kids: 1, plusOnes: 1, people: 7 });
    expect(d.withheldColumns).toContain('Email');
  });

  it('says plainly when the sheet is not connected', async () => {
    setProviderOverride('guest-sheet', new UnconfiguredGuestSheet(['GUEST_SHEET_ID']));
    const e = expectErr(await run(adminGuestSheet, admin(), {}));
    expect(e.code).toBe('provider_unavailable');
    expect(e.message).toMatch(/isn't connected yet/);
  });
});
