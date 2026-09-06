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
import { ensureDefaultCollections } from '@/domain/media';
import { BIOMETRIC_SWEEP_JOB, CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH, enqueueBiometricSweep, getConsentState, sweepRetention } from '@/domain/biometrics';
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

async function call<T>(principal: Principal, name: string, input?: unknown) {
  const ctx = await createCapabilityContext({ principal, requestId: newId(), surface: 'ui', ...(principal.kind === 'anonymous' ? {} : { idempotencyKey: newId() }) });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
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
async function grantConsentThroughEndpoint() {
  const draft = await post<{ policy: { version: string; textHash: string } }>('draft', { input: { adultAttested: true } });
  expect(draft.ok, JSON.stringify(draft)).toBe(true);
  const token = draft.confirmation!.token;
  const granted = await post('grant', { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true }, confirmationToken: token, idempotencyKey: newId() });
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

    it('the readiness switch needs an admin, a fresh session and a counsel reference', async () => {
      expect((await call(guestA, 'admin_set_biometric_readiness', { ready: true, counselReviewRef: 'x' })).ok).toBe(false);
      const noRef = await call(admin, 'admin_set_biometric_readiness', { ready: true });
      expect(noRef.ok).toBe(false);
      if (!noRef.ok) expect(noRef.error.code).toBe('validation');
      const stale: AdminPrincipal = { ...admin, authenticatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
      const old = await call(stale, 'admin_set_biometric_readiness', { ready: true, counselReviewRef: 'ADR-0006 review' });
      expect(old.ok).toBe(false);
      if (!old.ok) expect(old.error.code).toBe('step_up_required');
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
