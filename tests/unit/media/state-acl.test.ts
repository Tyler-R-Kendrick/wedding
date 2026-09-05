import { describe, expect, it } from 'vitest';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { ASSET_STATUSES, type AssetStatus, MODERATION_ACTIONS } from '@/db/schema/media';
import { canDeleteAsset, canViewAssetDetail, canViewCollection, canViewPublishedAsset, isMediaAdmin } from '@/domain/media/acl';
import { signDerivativeRead } from '@/domain/media/signed';
import { ASSET_TRANSITIONS, canTransition, describeStatus, isInFlight, moderationTarget } from '@/domain/media/state';
import { installTestPrincipalResolver, isTestPrincipalEnabled, resolveTestPrincipal } from '@/capabilities/media/test-principal';
import { getPrincipal, setPrincipalResolver, anonymousResolver } from '@/lib/principal';

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

describe('test principal injector', () => {
  const env = { NODE_ENV: 'test', TEST_AUTH_SECRET: 'unit-test-secret-1234567890' };
  const req = (principal: unknown, secret = env.TEST_AUTH_SECRET) =>
    new Request('http://localhost/x', { headers: { 'x-test-principal': typeof principal === 'string' ? principal : JSON.stringify(principal), 'x-test-auth-secret': secret } });

  it('is inert unless NODE_ENV=test and the secret matches', () => {
    expect(isTestPrincipalEnabled({ NODE_ENV: 'production', TEST_AUTH_SECRET: env.TEST_AUTH_SECRET })).toBe(false);
    expect(isTestPrincipalEnabled({ NODE_ENV: 'development', TEST_AUTH_SECRET: env.TEST_AUTH_SECRET })).toBe(false);
    expect(isTestPrincipalEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(isTestPrincipalEnabled({ NODE_ENV: 'test', TEST_AUTH_SECRET: 'short' })).toBe(false);
    expect(isTestPrincipalEnabled(env)).toBe(true);
    const spec = { kind: 'guest', guestId: 'G1', householdId: 'H1', entitlements: ['upload_media'] };
    expect(resolveTestPrincipal(req(spec), { ...env, NODE_ENV: 'production' })).toBeNull();
    expect(resolveTestPrincipal(req(spec, 'wrong-secret-000000000'), env)).toBeNull();
    expect(resolveTestPrincipal(req('{not json'), env)).toBeNull();
    expect(resolveTestPrincipal(req({ kind: 'guest', guestId: 'G1' }), env)).toBeNull(); // schema
    expect(resolveTestPrincipal(req({ kind: 'guest', guestId: 'G1', householdId: 'H1', entitlements: ['root'] }), env)).toBeNull();
    expect(resolveTestPrincipal(req({ kind: 'system', component: 'x' }), env)).toBeNull(); // system is never injectable
    const p = resolveTestPrincipal(req(spec), env);
    expect(p).toMatchObject({ kind: 'guest', guestId: 'G1', householdId: 'H1' });
    expect(p && p.kind === 'guest' && p.entitlements.has('upload_media')).toBe(true);
    const a = resolveTestPrincipal(req({ kind: 'admin', adminId: 'A1', entitlements: ['admin_media'] }), env);
    expect(a && a.kind === 'admin' && a.roles.has('owner') && a.entitlements.has('admin_media')).toBe(true);
  });

  it('installs a wrapping resolver only when enabled and falls back for other requests', async () => {
    expect(installTestPrincipalResolver({ NODE_ENV: 'development', TEST_AUTH_SECRET: env.TEST_AUTH_SECRET })).toBe(false);
    setPrincipalResolver(anonymousResolver);
    expect(installTestPrincipalResolver(env)).toBe(true);
    expect(installTestPrincipalResolver(env)).toBe(false); // idempotent
    const p = await getPrincipal(req({ kind: 'guest', guestId: 'G9', householdId: 'H9', entitlements: [] }));
    expect(p.kind).toBe('guest');
    expect((await getPrincipal(new Request('http://localhost/x'))).kind).toBe('anonymous');
    setPrincipalResolver(anonymousResolver);
  });
});
