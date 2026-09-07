import { describe, expect, it } from 'vitest';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { ASSET_STATUSES, type AssetStatus, MODERATION_ACTIONS } from '@/db/schema/media';
import { canDeleteAsset, canViewAssetDetail, canViewCollection, canViewPublishedAsset, isMediaAdmin } from '@/domain/media/acl';
import { signDerivativeRead } from '@/domain/media/signed';
import { ASSET_TRANSITIONS, canTransition, describeStatus, isInFlight, moderationTarget } from '@/domain/media/state';

const guest = (id: string, household: string, entitlements: string[] = []): GuestPrincipal => ({
  kind: 'guest',
  authIdentityId: `a-${id}` as AuthIdentityId,
  guestId: id as GuestId,
  householdId: household as HouseholdId,
  actsFor: [id as GuestId],
  entitlements: new Set(entitlements as never[]),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
});
const admin = (entitlements: string[] = ['admin_media']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'a-admin' as AuthIdentityId,
  adminId: 'ADMIN1' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never[]),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
});
const anon: Principal = { kind: 'anonymous' };

describe('asset state machine', () => {
  it('covers every status and only allows documented transitions', () => {
    for (const s of ASSET_STATUSES) expect(ASSET_TRANSITIONS[s]).toBeDefined();
    expect(canTransition('quarantined', 'validating')).toBe(true);
    expect(canTransition('validating', 'processing')).toBe(true);
    expect(canTransition('processing', 'private')).toBe(true);
    expect(canTransition('private', 'published')).toBe(true);
    expect(canTransition('published', 'hidden')).toBe(true);
    expect(canTransition('hidden', 'published')).toBe(true);
    expect(canTransition('quarantined', 'published')).toBe(false);
    expect(canTransition('rejected', 'published')).toBe(false);
    expect(canTransition('deleted', 'published')).toBe(false);
    expect(canTransition('failed', 'processing')).toBe(true);
    expect(isInFlight('processing')).toBe(true);
    expect(isInFlight('private')).toBe(false);
  });

  it('maps moderation actions to targets by state', () => {
    expect(moderationTarget('approve', 'private')).toBe('published');
    expect(moderationTarget('approve', 'quarantined')).toBeNull();
    expect(moderationTarget('hide', 'published')).toBe('hidden');
    expect(moderationTarget('hide', 'private')).toBeNull();
    expect(moderationTarget('unhide', 'hidden')).toBe('published');
    expect(moderationTarget('reject', 'published')).toBe('rejected');
    expect(moderationTarget('reprocess', 'failed')).toBe('processing');
    expect(moderationTarget('delete', 'published')).toBe('deleted');
    expect(moderationTarget('delete', 'deleted')).toBeNull();
    expect(moderationTarget('restore', 'deleted')).toBe('private');
    expect(moderationTarget('restore', 'published')).toBeNull();
    expect(moderationTarget('report', 'published')).toBe('published');
    expect(moderationTarget('report', 'deleted')).toBeNull();
    // every mapped target is a legal transition (report keeps the state)
    for (const action of MODERATION_ACTIONS) {
      for (const from of ASSET_STATUSES) {
        const to = moderationTarget(action, from);
        if (to && to !== from) expect(canTransition(from, to), `${action} ${from}->${to}`).toBe(true);
      }
    }
    for (const s of ASSET_STATUSES) expect(describeStatus(s as AssetStatus).label.length).toBeGreaterThan(2);
  });
});

describe('media ACL', () => {
  const pub = { visibility: 'public' as const };
  const guests = { visibility: 'guests' as const };
  const priv = { visibility: 'private' as const };
  const household = { visibility: 'household' as const };
  const asset = (over: Partial<{ status: string; ownerGuestId: string | null; ownerHouseholdId: string | null; visibility: 'private' | 'household' | 'guests' | 'public' | null }> = {}) => ({ status: 'published', ownerGuestId: 'G1', ownerHouseholdId: 'H1', visibility: null, ...over });

  it('collections: public to all, guests need view_private_media, private admin-only', () => {
    expect(canViewCollection(anon, pub)).toBe(true);
    expect(canViewCollection(anon, guests)).toBe(false);
    expect(canViewCollection(guest('G2', 'H2'), guests)).toBe(false);
    expect(canViewCollection(guest('G2', 'H2', ['view_private_media']), guests)).toBe(true);
    expect(canViewCollection(guest('G2', 'H2', ['view_private_media']), priv)).toBe(false);
    expect(canViewCollection(admin(), priv)).toBe(true);
    expect(canViewCollection(admin([]), priv)).toBe(false); // admin without admin_media is not a media admin
    expect(isMediaAdmin({ kind: 'system', component: 'job' })).toBe(true);
  });

  it('assets: only published items are visible to others; owners see their own in any state', () => {
    const viewer = guest('G2', 'H2', ['view_private_media']);
    expect(canViewPublishedAsset(viewer, asset(), guests)).toBe(true);
    expect(canViewPublishedAsset(viewer, asset({ status: 'private' }), guests)).toBe(false);
    expect(canViewPublishedAsset(anon, asset(), guests)).toBe(false);
    expect(canViewPublishedAsset(anon, asset(), pub)).toBe(true);
    expect(canViewPublishedAsset(viewer, asset({ visibility: 'private' }), pub)).toBe(false); // asset override narrows
    expect(canViewPublishedAsset(guest('G1', 'H1', ['view_private_media']), asset({ visibility: 'private' }), pub)).toBe(true);
    expect(canViewPublishedAsset(guest('G3', 'H1', ['view_private_media']), asset(), household)).toBe(true);
    expect(canViewPublishedAsset(guest('G3', 'H9', ['view_private_media']), asset(), household)).toBe(false);
    expect(canViewAssetDetail(guest('G1', 'H1'), asset({ status: 'private' }), guests)).toBe(true);
    expect(canViewAssetDetail(guest('G2', 'H2', ['view_private_media']), asset({ status: 'private' }), guests)).toBe(false);
    expect(canViewAssetDetail(admin(), asset({ status: 'quarantined' }), priv)).toBe(true);
    expect(canDeleteAsset(guest('G1', 'H1'), { ownerGuestId: 'G1', source: 'guest' })).toBe(true);
    expect(canDeleteAsset(guest('G2', 'H2'), { ownerGuestId: 'G1', source: 'guest' })).toBe(false);
    expect(canDeleteAsset(guest('G1', 'H1'), { ownerGuestId: 'G1', source: 'professional' })).toBe(false);
  });

  it('never signs anything outside derivatives/', async () => {
    const calls: string[] = [];
    const storage = { createSignedReadUrl: async (i: { key: string }) => (calls.push(i.key), { ok: true as const, value: { url: `signed:${i.key}`, method: 'GET' as const, headers: {}, expiresAt: 'x' } }) };
    expect(await signDerivativeRead(storage as never, 'originals/guest/G1/x.jpg')).toBeNull();
    expect(await signDerivativeRead(storage as never, 'quarantine/x/original')).toBeNull();
    expect(await signDerivativeRead(storage as never, 'derivatives/../originals/guest/G1/x.jpg')).toBeNull();
    expect((await signDerivativeRead(storage as never, 'derivatives/thumb/x.webp'))?.url).toBe('signed:derivatives/thumb/x.webp');
    expect(calls).toEqual(['derivatives/thumb/x.webp']);
  });
});

/*
 * Swarm H's `describe('test principal injector')` block lived here, testing its own resolver in
 * `src/capabilities/media/test-principal.ts`. Both are deleted: identity owns that resolver, and
 * `tests/unit/test-principal-gate.test.ts` already covers every case this block did — disabled
 * outside NODE_ENV=test, no secret, a secret too short to be one, a wrong secret, a missing header,
 * unparseable JSON, an unknown `kind`, and the positive injection. The two cases identity's gate
 * did NOT have — `system` is never injectable, and an unknown entitlement is refused — are ported
 * there rather than kept here, so there is one test for one resolver.
 */
