import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as biometricsRoute } from '@/app/api/biometrics/[action]/route';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import { consentIpHash, type BiometricStatusView, type MyBiometricConsent } from '@/capabilities/biometrics';
import type { SearchMediaResult } from '@/capabilities/mediaai';
import { installTestPrincipalResolver } from '@/capabilities/media/test-principal';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { biometricConsents, biometricDeletions, biometricIdentityRefs, biometricMatches } from '@/db/schema/biometrics';
import { idempotencyKeys } from '@/db/schema/idempotency';
import { ensureDefaultCollections } from '@/domain/media';
import { BIOMETRIC_SWEEP_JOB, CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH, enqueueBiometricSweep, getConsentState, grantConsent, guestScopeKey, revokeConsent, sweepRetention, sweepRetentionDetailed } from '@/domain/biometrics';
import { listAuditEvents } from '@/lib/audit';
import { getAuditSink } from '@/lib/audit';
import { invalidateReadinessCache, setReadiness } from '@/lib/flags';
import { runDueJobs } from '@/lib/jobs';
import type { BiometricProvider } from '@/providers/biometric/types';
import { createBiometricProvider } from '@/providers/biometric';
import { isEnabled } from '@/lib/flags';
import { LocalFsStorage } from '@/providers/storage';
import { resetProviders, setProviderOverride } from '@/providers/registry';
import { FakeMediaAi, placeCorpus, type PlacedItem } from '../helpers/media-ai-fixtures';

const TEST_AUTH_SECRET = 'integration-test-auth-secret-0123456789';
const GUEST_A = 'GUESTA';

const guestA: GuestPrincipal = { kind: 'guest', authIdentityId: 'auth-a' as AuthIdentityId, guestId: GUEST_A as GuestId, householdId: 'HOUSEA' as HouseholdId, actsFor: [GUEST_A as GuestId], entitlements: new Set(['upload_media', 'view_private_media', 'use_face_matching']), authenticatedAt: new Date().toISOString(), sessionId: 'sa' };
const guestB: GuestPrincipal = { ...guestA, authIdentityId: 'auth-b' as AuthIdentityId, guestId: 'GUESTB' as GuestId, householdId: 'HOUSEB' as HouseholdId, actsFor: ['GUESTB' as GuestId], sessionId: 'sb' };
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth-adm' as AuthIdentityId, adminId: 'ADMIN1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_media', 'admin_ai', 'admin_lifecycle']), authenticatedAt: new Date().toISOString(), sessionId: 'sadm' };
const anon: Principal = { kind: 'anonymous' };

/**
 * Counts every question anyone asks the biometric seam. "No biometric work happened" is then a
 * measured fact, not an assumption: the counters stay at zero whenever a gate is closed.
 */
class SpyBiometric implements BiometricProvider {
  readonly kind = 'biometric' as const;
  readonly name: string;
  readonly mode = 'mock' as const;
  readonly capabilities: Record<string, boolean>;
  calls = { assertReady: 0, extract: 0, enroll: 0, match: 0, delete: 0 };
  constructor(private readonly inner: BiometricProvider) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
  }
  reset() {
    this.calls = { assertReady: 0, extract: 0, enroll: 0, match: 0, delete: 0 };
  }
  /** Anything that would touch a face, whether or not the inner provider allowed it. */
  get biometricWork() {
    return this.calls.extract + this.calls.enroll + this.calls.match;
  }
  validateConfig() {
    return this.inner.validateConfig();
  }
  health() {
    return this.inner.health();
  }
  assertReady(subjectId?: string) {
    this.calls.assertReady++;
    return this.inner.assertReady(subjectId);
  }
  extract(input: { subjectId: string; bytes: Uint8Array; contentType: string }) {
    this.calls.extract++;
    return this.inner.extract(input);
  }
  enroll(input: { subjectId: string; vector: number[] }) {
    this.calls.enroll++;
    return this.inner.enroll(input);
  }
  match(input: { vector: number[]; k?: number; threshold?: number; subjectId: string }) {
    this.calls.match++;
    return this.inner.match(input);
  }
  delete(subjectId: string) {
    this.calls.delete++;
    return this.inner.delete(subjectId);
  }
}

let dir: string;
let storage: LocalFsStorage;
let spy: SpyBiometric;
let corpus: Map<string, PlacedItem>;

async function call<T>(principal: Principal, name: string, input?: unknown, opts: { idempotencyKey?: string; confirmationToken?: string } = {}) {
  const key = opts.idempotencyKey ?? (principal.kind === 'anonymous' ? undefined : newId());
  const ctx = await createCapabilityContext({
    principal,
    requestId: newId(),
    surface: 'ui',
    ...(key ? { idempotencyKey: key } : {}),
    ...(opts.confirmationToken ? { confirmationToken: opts.confirmationToken } : {}),
  });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
}

/** A draft capability, keeping the confirmation it issues. */
async function draftCall<T>(principal: Principal, name: string, input?: unknown) {
  const ctx = await createCapabilityContext({ principal, requestId: newId(), surface: 'ui' });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T, confirmation: r.value.confirmation } : { ok: false as const, error: r.error };
}

/** POST /api/biometrics/<action> exactly as the opt-in page does it. */
async function post<T>(action: string, body: Record<string, unknown>, principal: 'guestA' | 'guestB' | 'anon' = 'guestA', extraHeaders: Record<string, string> = {}) {
  const specs: Record<string, unknown> = {
    guestA: { kind: 'guest', guestId: GUEST_A, householdId: 'HOUSEA', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] },
    guestB: { kind: 'guest', guestId: 'GUESTB', householdId: 'HOUSEB', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] },
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.7', ...extraHeaders };
  if (principal !== 'anon') {
    headers['x-test-principal'] = JSON.stringify(specs[principal]);
    headers['x-test-auth-secret'] = TEST_AUTH_SECRET;
  }
  const res = await biometricsRoute(new Request(`http://localhost:3000/api/biometrics/${action}`, { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; confirmation?: { token: string } };
  return { status: res.status, ...json };
}

async function setFlag(on: boolean) {
  if (on) process.env.FLAG_BIOMETRICS_ENABLED = 'on';
  else delete process.env.FLAG_BIOMETRICS_ENABLED;
}

async function setReady(ready: boolean) {
  const db = await getDb();
  await setReadiness(db, { flag: 'BIOMETRICS_ENABLED', ready, actor: { kind: 'system', component: 'test' }, requestId: newId(), audit: await getAuditSink() });
  invalidateReadinessCache();
}

/** Draft + grant through the consent endpoint, the only path that can write the ledger. */
async function grantConsentThroughEndpoint(who: 'guestA' | 'guestB' = 'guestA') {
  const draft = await post<{ policy: { version: string; textHash: string } }>('draft', { input: { adultAttested: true } }, who);
  expect(draft.ok, JSON.stringify(draft)).toBe(true);
  const token = draft.confirmation!.token;
  const granted = await post('grant', { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true }, confirmationToken: token, idempotencyKey: newId() }, who);
  expect(granted.ok, JSON.stringify(granted)).toBe(true);
  return granted;
}

describe('biometric subsystem (gated off by default)', () => {
  beforeAll(async () => {
    process.env.TEST_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.SITE_URL ??= 'http://localhost:3000';
    installTestPrincipalResolver();
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-biometrics-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'integration-storage-secret-123', now: () => new Date() });
    resetProviders();
    setProviderOverride('storage', storage);
    const db = await getDb();
    // The domain module installs the consent lookup the provider's assertReady uses.
    await import('@/domain/biometrics');
    spy = new SpyBiometric(createBiometricProvider({ readiness: () => isEnabled('BIOMETRICS_ENABLED', { db }) }));
    setProviderOverride('biometric', spy);
    await ensureDefaultCollections(db, new Date());
    corpus = await placeCorpus(db, storage, new FakeMediaAi(), [
      { ref: 'mine-1', collectionSlug: 'guest-uploads', caption: 'Me at the reception' },
      { ref: 'mine-2', collectionSlug: 'guest-uploads', caption: 'Me again' },
      { ref: 'theirs', collectionSlug: 'guest-uploads', ownerGuestId: 'GUESTB', ownerHouseholdId: 'HOUSEB', caption: 'Someone else' },
      { ref: 'hidden-from-me', collectionSlug: 'guest-uploads', ownerGuestId: 'GUESTB', ownerHouseholdId: 'HOUSEB', visibility: 'private', caption: 'Not visible to me' },
      { ref: 'pro', collectionSlug: 'full-ceremony', source: 'professional', vendor: 'brooke-alaina-photography', rights: { vendorName: 'Brooke Alaina Photography', allowAiProcessing: false } },
    ], new Date());
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
    resetProviders();
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => spy.reset());

  describe('with the feature flag off (the shipping default)', () => {
    beforeAll(async () => {
      await setFlag(false);
      await setReady(false);
    });

    it('refuses every face-matching capability and touches no biometric code', async () => {
      for (const [name, input] of [['find_photos_of_me', { candidateAssetIds: [corpus.get('mine-1')!.assetId] }], ['enroll_biometric_reference', { assetIds: [corpus.get('mine-1')!.assetId] }], ['draft_biometric_consent', { adultAttested: true }]] as const) {
        const r = await call(guestA, name, input);
        expect(r.ok, name).toBe(false);
        if (!r.ok) expect(r.error.code, name).toBe('feature_disabled');
      }
      expect(spy.biometricWork).toBe(0);
      expect(spy.calls.assertReady).toBe(0);
    });

    it('tells the guest the feature is unavailable and shows no consent text at all', async () => {
      const view = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(view.data).toMatchObject({ available: false, unavailableReason: 'flag_off', policy: null, hasData: false });
      expect(view.data.consent.status).toBe('none');
      expect(JSON.stringify(view.data)).not.toContain('biometric identifier');
    });

    it('semantic search is entirely unaffected: it works with zero biometric data', async () => {
      expect((await call(admin, 'admin_reindex_media', { full: true })).ok).toBe(true);
      const db = await getDb();
      for (let i = 0; i < 4; i++) await runDueJobs(db, { worker: 'test', limit: 200 });
      const r = await call<SearchMediaResult>(guestA, 'search_media', { query: 'me at the reception' });
      expect(r.ok && r.data.items.length).toBeGreaterThan(0);
      expect(spy.biometricWork).toBe(0);
      expect(Number((await db.select().from(biometricIdentityRefs)).length)).toBe(0);
    });

    it('still lets a guest withdraw consent and demand deletion (obligations outlive the feature)', async () => {
      const revoked = await call<{ revoked: boolean }>(guestA, 'revoke_biometric_consent', {});
      expect(revoked.ok && revoked.data.revoked).toBe(false); // nothing to withdraw yet, but the door is open
      const deletion = await call<{ deletion: { id: string; status: string } }>(guestA, 'request_biometric_deletion', {});
      expect(deletion.ok, JSON.stringify(deletion)).toBe(true);
      if (!deletion.ok) return;
      const db = await getDb();
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      const row = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.id, deletion.data.deletion.id)))[0]!;
      expect(row.status).toBe('completed');
      expect(row.proof).toMatchObject({ identityRefsDeleted: 0, matchesDeleted: 0, vectorEntriesDeleted: 0 });
      await db.delete(biometricDeletions);
    });

    it('refuses anonymous callers and guests without the entitlement', async () => {
      expect((await call(anon, 'get_my_biometric_consent', {})).ok).toBe(false);
      const noEntitlement: GuestPrincipal = { ...guestA, entitlements: new Set(['view_private_media']) };
      const r = await call(noEntitlement, 'find_photos_of_me', { candidateAssetIds: [corpus.get('mine-1')!.assetId] });
      expect(r.ok).toBe(false);
      expect(spy.biometricWork).toBe(0);
    });
  });

  describe('with the flag on but the readiness switch off', () => {
    beforeAll(async () => {
      await setFlag(true);
      await setReady(false);
    });

    it('still refuses everything: one gate is not enough', async () => {
      const r = await call(guestA, 'find_photos_of_me', { candidateAssetIds: [corpus.get('mine-1')!.assetId] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('feature_disabled');
      expect(spy.biometricWork).toBe(0);
      const view = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
      expect(view.ok && view.data).toMatchObject({ available: false, unavailableReason: 'readiness_off', policy: null });
    });

    it('switching readiness on needs an admin, a fresh session, a real reference and a confirmation', async () => {
      const REF = 'ADR-0006 §7 addendum, counsel memo of 2027-01-14';
      // Not an admin.
      expect((await call(guestA, 'draft_biometric_readiness', { counselReviewRef: REF })).ok).toBe(false);
      expect((await call(guestA, 'admin_enable_biometric_readiness', { counselReviewRef: REF })).ok).toBe(false);
      // A placeholder is not a reference.
      for (const bad of ['asd', '', '   ', 'placeholder!!']) {
        const r = await call(admin, 'draft_biometric_readiness', { counselReviewRef: bad });
        expect(r.ok, bad).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('validation');
      }
      // A stale session cannot even draft.
      const stale: AdminPrincipal = { ...admin, authenticatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
      const old = await call(stale, 'draft_biometric_readiness', { counselReviewRef: REF });
      expect(old.ok).toBe(false);
      if (!old.ok) expect(old.error.code).toBe('step_up_required');
      // And without the token from the draft, the switch refuses.
      const noToken = await call(admin, 'admin_enable_biometric_readiness', { counselReviewRef: REF });
      expect(noToken.ok).toBe(false);
      if (!noToken.ok) expect(noToken.error.code).toBe('confirmation_required');
    });

    it('switching readiness off is always allowed: no token, no reference, no flag', async () => {
      const db = await getDb();
      const { featureFlags } = await import('@/db/schema');
      await setReady(true);
      await db.update(featureFlags).set({ note: 'a stale reference' }).where(eq(featureFlags.name, 'BIOMETRICS_ENABLED'));
      invalidateReadinessCache();
      const off = await call<{ readiness: boolean }>(admin, 'admin_disable_biometric_readiness', {});
      expect(off.ok, JSON.stringify(off)).toBe(true);
      expect(off.ok && off.data.readiness).toBe(false);
      // The recorded reference goes with it: it must never look like it justifies a live gate.
      const row = (await db.select().from(featureFlags).where(eq(featureFlags.name, 'BIOMETRICS_ENABLED')))[0];
      expect(row?.note ?? null).toBeNull();
      await setReady(false);
    });

    it('a drafted readiness token is single-use and bound to the reference it was drafted for', async () => {
      const REF = 'ADR-0006 §7 addendum, counsel memo of 2027-01-14';
      process.env.FLAG_BIOMETRICS_ENABLED = 'on';
      const drafted = await draftCall<{ readiness: { counselReviewRef: string }; consequences: string[] }>(admin, 'draft_biometric_readiness', { counselReviewRef: REF });
      expect(drafted.ok, JSON.stringify(drafted)).toBe(true);
      if (!drafted.ok) return;
      expect(drafted.data.consequences.join(' ')).toMatch(/durable record of which photographs/);
      const token = drafted.confirmation!.token;
      // The token is bound to the payload: a different reference cannot ride it.
      const swapped = await call(admin, 'admin_enable_biometric_readiness', { counselReviewRef: 'LEGAL-9999 something else' }, { confirmationToken: token });
      expect(swapped.ok).toBe(false);
      // Used once...
      expect((await call(admin, 'admin_enable_biometric_readiness', { counselReviewRef: REF }, { confirmationToken: token })).ok).toBe(true);
      // ...and never again.
      const replay = await call(admin, 'admin_enable_biometric_readiness', { counselReviewRef: REF }, { confirmationToken: token });
      expect(replay.ok).toBe(false);
      expect((await call(admin, 'admin_disable_biometric_readiness', {})).ok).toBe(true);
      await setReady(false);
    });

    it('shows an honest readiness checklist to admins', async () => {
      const status = await call<BiometricStatusView>(admin, 'admin_biometric_status', {});
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(status.data).toMatchObject({ flag: true, readiness: false, enabled: false });
      expect(status.data.policy.counselReviewed).toBe(false);
      expect(status.data.provider.mode).toBe('mock');
      const counsel = status.data.checklist.find((c) => c.item.includes('counsel'));
      expect(counsel).toMatchObject({ done: false });
      expect(JSON.stringify(status.data)).not.toContain('templateSealed');
    });
  });

  describe('with both gates open but no consent', () => {
    beforeAll(async () => {
      await setFlag(true);
      await setReady(true);
    });

    it('refuses matching and enrolment until the guest has agreed, and calls no provider', async () => {
      const find = await call(guestA, 'find_photos_of_me', { candidateAssetIds: [corpus.get('mine-1')!.assetId] });
      expect(find.ok).toBe(false);
      if (!find.ok) {
        expect(find.error.code).toBe('conflict');
        expect(find.error.details?.reason).toBe('consent_required');
      }
      const enroll = await call(guestA, 'enroll_biometric_reference', { assetIds: [corpus.get('mine-1')!.assetId] });
      expect(enroll.ok).toBe(false);
      expect(spy.biometricWork).toBe(0);
    });

    it('offers the exact consent text, and the seam itself still refuses an unconsented subject', async () => {
      const view = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
      expect(view.ok && view.data.available).toBe(true);
      expect(view.ok && view.data.policy?.version).toBe(CONSENT_POLICY_VERSION);
      expect(view.ok && view.data.policy?.textHash).toBe(CONSENT_TEXT_HASH);
      expect(view.ok && view.data.policy?.counselReviewed).toBe(false);
      // Even a caller that reached the provider directly gets nothing without consent.
      await expect(spy.extract({ subjectId: GUEST_A, bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' })).rejects.toMatchObject({ code: 'feature_disabled' });
    });
  });

  describe('the consent ledger', () => {
    beforeAll(async () => {
      await setFlag(true);
      await setReady(true);
      const db = await getDb();
      await db.delete(biometricConsents);
      await db.delete(biometricIdentityRefs);
      await db.delete(biometricMatches);
      await db.delete(biometricDeletions);
    });

    it('only accepts a grant from the website, with the confirmation token from the draft step', async () => {
      // No token at all.
      const bare = await post('grant', { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true }, idempotencyKey: newId() });
      expect(bare.ok).toBe(false);
      expect(bare.error?.code).toBe('confirmation_required');
      // A token issued for this guest cannot be redeemed by another one.
      const draft = await post<{ policy: unknown }>('draft', { input: { adultAttested: true } });
      expect(draft.ok).toBe(true);
      const stolen = await post('grant', { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true }, confirmationToken: draft.confirmation!.token, idempotencyKey: newId() }, 'guestB');
      expect(stolen.ok).toBe(false);
      // A cross-origin post is refused before anything else.
      const crossOrigin = await post('grant', { input: {} }, 'guestA', { 'sec-fetch-site': 'cross-site', Origin: 'https://evil.example' });
      expect(crossOrigin.status).toBe(403);
      expect((await getConsentState(await getDb(), GUEST_A)).status).toBe('none');
    });

    it('records a grant bound to the exact policy text, with a hashed IP and never the IP itself', async () => {
      await grantConsentThroughEndpoint();
      const db = await getDb();
      const rows = await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A));
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({ entry: 'grant', policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, scope: 'self_match', adultAttested: true, surface: 'ui' });
      expect(row.text).toContain('withdraw');
      // A keyed hash, never the address. (Which address it hashes depends on TRUSTED_PROXY_HOPS;
      // that it is a one-way, key-dependent digest does not.)
      expect(row.ipHash).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(row.ipHash).not.toContain('203.0.113.7');
      expect(consentIpHash('203.0.113.7')).not.toBe(consentIpHash('198.51.100.9'));
      expect(consentIpHash('203.0.113.7')).toBe(consentIpHash('203.0.113.7'));
      expect(consentIpHash('203.0.113.7')).not.toContain('203.0.113');
      expect((await getConsentState(db, GUEST_A)).status).toBe('active');
      const audit = await listAuditEvents(db, { limit: 200 });
      expect(audit.some((e) => e.action === 'biometric.consent_granted')).toBe(true);
    });

    it('refuses a second grant and a grant for text the guest did not see', async () => {
      const again = await post('draft', { input: { adultAttested: true } });
      expect(again.ok).toBe(false);
      expect(again.error?.details?.['reason']).toBe('already_active');
      const db = await getDb();
      expect(await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A))).toHaveLength(1);
    });

    it('requires the adult attestation: minors are blocked pending a guardian-consent design', async () => {
      const minor = await post('draft', { input: { adultAttested: false } }, 'guestB');
      expect(minor.ok).toBe(false);
      expect(minor.error?.code).toBe('validation');
    });
  });

  describe('consent-scoped matching', () => {
    it('enrols from the guest\'s own uploads only', async () => {
      const notMine = await call(guestA, 'enroll_biometric_reference', { assetIds: [corpus.get('theirs')!.assetId] });
      expect(notMine.ok).toBe(false);
      if (!notMine.ok) expect(notMine.error.code).toBe('forbidden');
      const enrolled = await call<{ identityRefId: string; references: number }>(guestA, 'enroll_biometric_reference', { assetIds: [corpus.get('mine-1')!.assetId, corpus.get('mine-2')!.assetId] });
      expect(enrolled.ok, JSON.stringify(enrolled)).toBe(true);
      if (!enrolled.ok) return;
      expect(enrolled.data.references).toBe(2);
      const db = await getDb();
      // Re-enrolling replaces the previous reference rather than accumulating templates.
      const refs = await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A));
      expect(refs).toHaveLength(1);
      const ref = refs[0]!;
      // The template is sealed: the vector is nowhere in the row.
      expect(ref.templateSealed).not.toContain('0.');
      expect(ref.templateKeyId).toBeTruthy();
      expect(ref.sourceAssetIds).toHaveLength(2);
    });

    it('checks only the photos the guest picked, and skips what they may not see', async () => {
      // Re-enrol from a single reference first. The mock provider's "template" is a hash of the
      // image bytes, so two different fixture photos are deliberately uncorrelated and their
      // average sits ~45 degrees from each source -- below the match threshold. A real provider's
      // templates for one person are not uncorrelated; this is a property of the double, so the
      // matching assertions use a single reference to stay deterministic.
      expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [corpus.get('mine-1')!.assetId] })).ok).toBe(true);
      spy.reset();
      const result = await call<{ matched: { id: string }[]; checked: number; skipped: { assetId: string; reason: string }[] }>(guestA, 'find_photos_of_me', {
        candidateAssetIds: [corpus.get('mine-1')!.assetId, corpus.get('hidden-from-me')!.assetId, corpus.get('pro')!.assetId],
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.data.matched.map((m) => m.id)).toEqual([corpus.get('mine-1')!.assetId]);
      expect(result.data.checked).toBe(1);
      const reasons = Object.fromEntries(result.data.skipped.map((s) => [s.assetId, s.reason]));
      expect(reasons[corpus.get('hidden-from-me')!.assetId]).toBe('not_visible');
      expect(reasons[corpus.get('pro')!.assetId]).toBe('professional_gate');
      // One extraction, for the one candidate that passed every check. No bulk pass over the archive.
      expect(spy.calls.extract).toBe(1);
      const db = await getDb();
      const matches = await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A));
      expect(matches).toHaveLength(1);
      expect(Object.keys(matches[0]!)).not.toContain('vector');
    });

    it('never returns another guest\'s data from the guest-facing view', async () => {
      const mine = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
      const theirs = await call<MyBiometricConsent>(guestB, 'get_my_biometric_consent', {});
      expect(mine.ok && mine.data.enrolment?.references).toBe(1);
      expect(mine.ok && mine.data.matches).toHaveLength(1);
      expect(theirs.ok && theirs.data.enrolment).toBeNull();
      expect(theirs.ok && theirs.data.matches).toEqual([]);
      expect(mine.ok && JSON.stringify(mine.data)).not.toContain('ipHash');
    });
  });

  describe('what a deletion has to reach', () => {
    // A separate guest throughout, so this block's deletions cannot disturb the state the
    // withdrawal tests below depend on.
    const mine = () => corpus.get('theirs')!.assetId; // owned by GUESTB

    beforeAll(async () => {
      await setFlag(true);
      await setReady(true);
      await grantConsentThroughEndpoint('guestB');
      expect((await call(guestB, 'enroll_biometric_reference', { assetIds: [mine()] })).ok).toBe(true);
    });

    it('never leaves the biometric result in the public idempotency table', async () => {
      const db = await getDb();
      const key = newId();
      const found = await call<{ matched: { id: string }[] }>(guestB, 'find_photos_of_me', { candidateAssetIds: [mine()] }, { idempotencyKey: key });
      expect(found.ok, JSON.stringify(found)).toBe(true);
      if (!found.ok) return;
      expect(found.data.matched).toHaveLength(1);
      // The result IS biometric data; the pipeline reserves the key but stores no body.
      expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.scope, `find_photos_of_me:${guestScopeKey('GUESTB')}`))).toHaveLength(0);
      const everything = await db.select().from(idempotencyKeys);
      expect(JSON.stringify(everything)).not.toContain(mine());
    });

    it('re-runs rather than replaying, so a withdrawn consent stops a repeat of the same request', async () => {
      const db = await getDb();
      const key = newId();
      const input = { candidateAssetIds: [mine()] };
      expect((await call(guestB, 'find_photos_of_me', input, { idempotencyKey: key })).ok).toBe(true);
      // Same key, same payload. Before the fix this replayed a stored answer without re-gating.
      expect((await call(guestB, 'find_photos_of_me', input, { idempotencyKey: key })).ok).toBe(true);
      expect((await post('revoke', { input: {}, idempotencyKey: newId() }, 'guestB')).ok).toBe(true);
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      const replay = await call(guestB, 'find_photos_of_me', input, { idempotencyKey: key });
      expect(replay.ok, 'a repeat after withdrawal must be refused, not served from a cache').toBe(false);
      if (!replay.ok) expect(replay.error.code).toBe('conflict');
    });

    it('purges a cached response written before the opt-out existed, and proves the index is empty', async () => {
      const db = await getDb();
      await grantConsentThroughEndpoint('guestB');
      expect((await call(guestB, 'enroll_biometric_reference', { assetIds: [mine()] })).ok).toBe(true);
      // A row of the shape the pipeline used to write (or that a future capability forgets to opt out of).
      await db.insert(idempotencyKeys).values({
        scope: `find_photos_of_me:${guestScopeKey('GUESTB')}`,
        key: 'legacy-cached-result',
        payloadHash: 'h',
        status: 'complete',
        response: { data: { matched: [{ id: mine(), score: 1 }] } },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const deletion = await call<{ deletion: { id: string } }>(guestB, 'request_biometric_deletion', {});
      expect(deletion.ok).toBe(true);
      if (!deletion.ok) return;
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      const row = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.id, deletion.data.deletion.id)))[0]!;
      expect(row.status).toBe('completed');
      expect(row.proof!.cachedResponsesDeleted).toBeGreaterThanOrEqual(1);
      expect(row.proof!.vectorEntriesRemaining).toBe(0);
      expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'legacy-cached-result'))).toHaveLength(0);
      // The confirmation nonce is NOT purged: a used grant token must stay used.
      const nonces = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.scope, `confirm:grant_biometric_consent:${guestScopeKey('GUESTB')}`));
      expect(nonces.length).toBeGreaterThan(0);
    });
  });

  describe('withdrawal, deletion and retention', () => {
    it('withdrawing consent queues deletion and the job proves what it removed', async () => {
      const db = await getDb();
      const revoked = await post<{ revoked: boolean; deletion: { id: string } }>('revoke', { input: {}, idempotencyKey: newId() });
      expect(revoked.ok, JSON.stringify(revoked)).toBe(true);
      if (!revoked.ok || !revoked.data) return;
      expect(revoked.data.revoked).toBe(true);
      expect((await getConsentState(db, GUEST_A)).status).toBe('revoked');
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      const deletion = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.id, revoked.data.deletion.id)))[0]!;
      expect(deletion.status).toBe('completed');
      expect(deletion.proof).toMatchObject({ identityRefsDeleted: 1, matchesDeleted: 1, providerSubjectsDeleted: 1, vectorEntriesDeleted: 0 });
      expect(deletion.proof!.consentIds).toHaveLength(1);
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(0);
      expect(await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A))).toHaveLength(0);
      // The consent history itself is retained as evidence, and the deletion is audited.
      expect((await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A))).length).toBe(2);
      const audit = await listAuditEvents(db, { limit: 300 });
      expect(audit.some((e) => e.action === 'biometric.deleted' && e.outcome === 'success')).toBe(true);
    });

    it('withdrawing again after a failed deletion still queues one, rather than doing nothing', async () => {
      const db = await getDb();
      // Consent is already revoked at this point; leave some data behind as a failed job would.
      await db.insert(biometricIdentityRefs).values({
        id: newId(), guestId: GUEST_A, consentId: 'STALE', providerName: 'mock', subjectId: GUEST_A,
        templateSealed: 'sealed', templateKeyId: 'k', sourceAssetIds: [], enrolledAt: new Date(), createdAt: new Date(),
      });
      const again = await call<{ revoked: boolean; deletion: { id: string } | null }>(guestA, 'revoke_biometric_consent', {});
      expect(again.ok, JSON.stringify(again)).toBe(true);
      if (!again.ok) return;
      expect(again.data.revoked).toBe(false); // there was nothing left to withdraw...
      expect(again.data.deletion, 'but the surviving data must still be queued for deletion').not.toBeNull();
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(0);
      // With nothing left at all it is a genuine no-op again.
      const noop = await call<{ revoked: boolean; deletion: unknown }>(guestA, 'revoke_biometric_consent', {});
      expect(noop.ok && noop.data).toMatchObject({ revoked: false, deletion: null });
    });

    it('matching stops the moment consent is withdrawn', async () => {
      spy.reset();
      const r = await call(guestA, 'find_photos_of_me', { candidateAssetIds: [corpus.get('mine-1')!.assetId] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.details?.reason).toBe('consent_revoked');
      expect(spy.biometricWork).toBe(0);
    });

    it('re-running a completed deletion is safe and completes again', async () => {
      const db = await getDb();
      const again = await call<{ deletion: { id: string } }>(guestA, 'request_biometric_deletion', {});
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      const row = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.id, again.data.deletion.id)))[0]!;
      expect(row.status).toBe('completed');
      expect(row.proof).toMatchObject({ identityRefsDeleted: 0, matchesDeleted: 0 });
    });

    it('the retention sweep asks for deletion of anything older than the window', async () => {
      const db = await getDb();
      await db.delete(biometricDeletions);
      await db.insert(biometricIdentityRefs).values({
        id: newId(),
        guestId: 'GUESTOLD',
        consentId: 'CONSENTOLD',
        providerName: 'mock',
        subjectId: 'GUESTOLD',
        templateSealed: 'sealed',
        templateKeyId: 'k',
        sourceAssetIds: [],
        enrolledAt: new Date(Date.now() - 400 * 86_400_000),
        createdAt: new Date(),
      });
      const requested = await sweepRetention(db, { retentionDays: 365, now: new Date(), requestId: newId() });
      expect(requested).toBe(1);
      const rows = await db.select().from(biometricDeletions).where(eq(biometricDeletions.guestId, 'GUESTOLD'));
      expect(rows[0]).toMatchObject({ reason: 'retention', status: 'requested' });
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      expect((await db.select().from(biometricDeletions).where(eq(biometricDeletions.guestId, 'GUESTOLD')))[0]!.status).toBe('completed');
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, 'GUESTOLD'))).toHaveLength(0);
    });

    it('sweeps a template whose consent is superseded, not only one that has aged out', async () => {
      const db = await getDb();
      await db.delete(biometricDeletions);
      await db.delete(biometricIdentityRefs);
      // A guest enrolled yesterday: nowhere near the retention window.
      await db.insert(biometricIdentityRefs).values({
        id: newId(),
        guestId: 'GUESTSUPER',
        consentId: 'CONSENTSUPER',
        providerName: 'mock',
        subjectId: 'GUESTSUPER',
        templateSealed: 'sealed',
        templateKeyId: 'k',
        sourceAssetIds: [],
        enrolledAt: new Date(Date.now() - 86_400_000),
        createdAt: new Date(),
      });
      // ...whose grant was for an older version of the consent copy.
      await db.insert(biometricConsents).values({
        id: newId(),
        guestId: 'GUESTSUPER',
        householdId: 'HOUSESUPER',
        entry: 'grant',
        grantId: null,
        policyVersion: '2020-01-01.superseded',
        textHash: 'a'.repeat(64),
        text: 'an older wording',
        purpose: 'p',
        term: 't',
        retention: 'r',
        providerDisclosure: 'd',
        scope: 'self_match',
        adultAttested: true,
        ipHash: null,
        surface: 'ui',
        requestId: newId(),
        grantedAt: new Date(Date.now() - 86_400_000),
        revokedAt: null,
        createdAt: new Date(Date.now() - 86_400_000),
      });
      expect((await getConsentState(db, 'GUESTSUPER')).status).toBe('superseded');

      const swept = await sweepRetentionDetailed(db, { retentionDays: 365, now: new Date(), requestId: newId() });
      expect(swept).toEqual([{ guestId: 'GUESTSUPER', reason: 'consent_not_active' }]);
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, 'GUESTSUPER'))).toHaveLength(0);
      // The consent history itself survives as evidence.
      expect((await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, 'GUESTSUPER'))).length).toBeGreaterThan(0);
    });

    it('leaves an active, recent enrolment completely alone', async () => {
      const db = await getDb();
      await db.delete(biometricDeletions);
      await db.delete(biometricIdentityRefs);
      await db.delete(biometricConsents);
      await grantConsentThroughEndpoint();
      expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [corpus.get('mine-1')!.assetId] })).ok).toBe(true);
      expect(await sweepRetentionDetailed(db, { retentionDays: 365, now: new Date(), requestId: newId() })).toEqual([]);
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(1);
    });

    it('sweeps data left behind by a deletion that failed, once consent is gone', async () => {
      const db = await getDb();
      const { jobs } = await import('@/db/schema/jobs');
      expect((await post('revoke', { input: {}, idempotencyKey: newId() })).ok).toBe(true);
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      expect((await getConsentState(db, GUEST_A)).status).toBe('revoked');

      // A reference that survived — the shape a deletion job leaves after exhausting its attempts.
      await db.insert(biometricIdentityRefs).values({
        id: newId(), guestId: GUEST_A, consentId: 'STALE', providerName: 'mock', subjectId: GUEST_A,
        templateSealed: 'sealed', templateKeyId: 'k', sourceAssetIds: [], enrolledAt: new Date(), createdAt: new Date(),
      });
      await db.delete(biometricDeletions);
      await db.delete(jobs);

      const swept = await sweepRetentionDetailed(db, { retentionDays: 365, now: new Date(), requestId: newId() });
      expect(swept).toEqual([{ guestId: GUEST_A, reason: 'consent_not_active' }]);
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'test', limit: 50 });
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(0);
    });

    it('the sweep is enqueued once, deduped, by the cron alias', async () => {
      const db = await getDb();
      await enqueueBiometricSweep(db);
      await enqueueBiometricSweep(db);
      const { jobs } = await import('@/db/schema/jobs');
      const queued = (await db.select().from(jobs)).filter((j) => j.type === BIOMETRIC_SWEEP_JOB && j.status === 'queued');
      expect(queued.length).toBeLessThanOrEqual(1);
    });
  });
});

describe('the consent ledger cannot hold two open grants', () => {
  beforeAll(async () => {
    await setFlag(true);
    await setReady(true);
    const db = await getDb();
    await db.delete(biometricConsents);
  });
  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  it('two flows racing produce exactly one grant, and the loser is told it already exists', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    const base = { guestId: 'RACEGUEST', householdId: 'RACEHOUSE', policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true, ipHash: 'h', surface: 'ui' };
    const [one, two] = await Promise.all([
      grantConsent(db, { ...base, requestId: newId(), now: new Date() }),
      grantConsent(db, { ...base, requestId: newId(), now: new Date(Date.now() + 1) }),
    ]);
    const outcomes = [one, two];
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)[0]).toMatchObject({ reason: 'already_active' });
    const grants = (await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, 'RACEGUEST'))).filter((r) => r.entry === 'grant');
    expect(grants).toHaveLength(1);
    expect((await getConsentState(db, 'RACEGUEST')).status).toBe('active');
  });

  it('two tabs racing through the public endpoint also produce exactly one grant', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    const [d1, d2] = await Promise.all([
      post<unknown>('draft', { input: { adultAttested: true } }, 'guestB'),
      post<unknown>('draft', { input: { adultAttested: true } }, 'guestB'),
    ]);
    expect(d1.ok && d2.ok).toBe(true);
    const input = { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true };
    const [g1, g2] = await Promise.all([
      post('grant', { input, confirmationToken: d1.confirmation!.token, idempotencyKey: newId() }, 'guestB'),
      post('grant', { input, confirmationToken: d2.confirmation!.token, idempotencyKey: newId() }, 'guestB'),
    ]);
    expect([g1.ok, g2.ok].filter(Boolean)).toHaveLength(1);
    const grants = (await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, 'GUESTB'))).filter((r) => r.entry === 'grant');
    expect(grants).toHaveLength(1);
  });

  it('withdrawing leaves no grant un-withdrawn, and the guest can agree again afterwards', async () => {
    const db = await getDb();
    await db.delete(biometricConsents);
    await grantConsentThroughEndpoint();
    const revoked = await revokeConsent(db, { guestId: GUEST_A, ipHash: null, surface: 'ui', requestId: newId(), now: new Date() });
    expect(revoked.revoked).toBe(true);
    const rows = await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A));
    const grants = rows.filter((r) => r.entry === 'grant');
    const revokes = rows.filter((r) => r.entry === 'revoke');
    expect(grants.filter((g) => !revokes.some((r) => r.grantId === g.id))).toHaveLength(0);
    expect(grants.every((g) => g.revokedAt !== null)).toBe(true);
    expect((await getConsentState(db, GUEST_A)).status).toBe('revoked');
    // Changing their mind must work: the index is scoped to OPEN grants, not to the wording.
    await grantConsentThroughEndpoint();
    expect((await getConsentState(db, GUEST_A)).status).toBe('active');
    expect((await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A))).filter((r) => r.entry === 'grant')).toHaveLength(2);
  });
});
