import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';

import { POST as biometricsRoute } from '@/app/api/biometrics/[action]/route';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import { installTestPrincipalResolver } from '@/capabilities/media/test-principal';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { ensureDefaultCollections } from '@/domain/media';
import { getAuditSink } from '@/lib/audit';
import { invalidateReadinessCache, isEnabled, setReadiness } from '@/lib/flags';
import { createBiometricProvider } from '@/providers/biometric';
import type { BiometricProvider } from '@/providers/biometric/types';
import { resetProviders, setProviderOverride } from '@/providers/registry';
import { LocalFsStorage } from '@/providers/storage';
import { FakeMediaAi, placeCorpus, type PlacedItem } from '../tests/helpers/media-ai-fixtures';

export const TEST_AUTH_SECRET = 'integration-test-auth-secret-0123456789';
export const GUEST_A = 'GUESTA';
export const GUEST_B = 'GUESTB';

export const guestA: GuestPrincipal = {
  kind: 'guest', authIdentityId: 'auth-a' as AuthIdentityId, guestId: GUEST_A as GuestId, householdId: 'HOUSEA' as HouseholdId,
  actsFor: [GUEST_A as GuestId], entitlements: new Set(['upload_media', 'view_private_media', 'use_face_matching']),
  authenticatedAt: new Date().toISOString(), sessionId: 'sa',
};
export const guestB: GuestPrincipal = { ...guestA, authIdentityId: 'auth-b' as AuthIdentityId, guestId: GUEST_B as GuestId, householdId: 'HOUSEB' as HouseholdId, actsFor: [GUEST_B as GuestId], sessionId: 'sb' };
export const admin: AdminPrincipal = {
  kind: 'admin', authIdentityId: 'auth-adm' as AuthIdentityId, adminId: 'ADMIN1' as AdminId, roles: new Set(['owner']),
  entitlements: new Set(['admin_media', 'admin_ai', 'admin_lifecycle']), authenticatedAt: new Date().toISOString(), sessionId: 'sadm',
};
export const anon: Principal = { kind: 'anonymous' };

/** Counts every question anyone asks the biometric seam (same shape as the swarm's own spy). */
export class SpyBiometric implements BiometricProvider {
  readonly kind = 'biometric' as const;
  readonly name: string;
  readonly mode = 'mock' as const;
  readonly capabilities: Record<string, boolean>;
  calls = { assertReady: 0, extract: 0, enroll: 0, match: 0, delete: 0 };
  constructor(readonly inner: BiometricProvider) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
  }
  reset() { this.calls = { assertReady: 0, extract: 0, enroll: 0, match: 0, delete: 0 }; }
  get biometricWork() { return this.calls.extract + this.calls.enroll + this.calls.match; }
  validateConfig() { return this.inner.validateConfig(); }
  health() { return this.inner.health(); }
  assertReady(subjectId?: string) { this.calls.assertReady++; return this.inner.assertReady(subjectId); }
  extract(i: { subjectId: string; bytes: Uint8Array; contentType: string }) { this.calls.extract++; return this.inner.extract(i); }
  enroll(i: { subjectId: string; vector: number[] }) { this.calls.enroll++; return this.inner.enroll(i); }
  match(i: { vector: number[]; k?: number; threshold?: number; subjectId: string }) { this.calls.match++; return this.inner.match(i); }
  delete(subjectId: string) { this.calls.delete++; return this.inner.delete(subjectId); }
}

export interface Rig {
  storage: LocalFsStorage;
  spy: SpyBiometric;
  corpus: Map<string, PlacedItem>;
  dir: string;
}

export async function buildRig(): Promise<Rig> {
  process.env.TEST_AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.SITE_URL ??= 'http://localhost:3000';
  installTestPrincipalResolver();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'review-I-'));
  const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'review-storage-secret-1234567', now: () => new Date() });
  resetProviders();
  setProviderOverride('storage', storage);
  const db = await getDb();
  await import('@/domain/biometrics');
  const spy = new SpyBiometric(createBiometricProvider({ readiness: () => isEnabled('BIOMETRICS_ENABLED', { db }) }));
  setProviderOverride('biometric', spy);
  await ensureDefaultCollections(db, new Date());
  const corpus = await placeCorpus(db, storage, new FakeMediaAi(), [
    { ref: 'mine-1', collectionSlug: 'guest-uploads', caption: 'Me at the reception' },
    { ref: 'mine-2', collectionSlug: 'guest-uploads', caption: 'Me again' },
    { ref: 'theirs', collectionSlug: 'guest-uploads', ownerGuestId: GUEST_B, ownerHouseholdId: 'HOUSEB', caption: 'Someone else' },
    { ref: 'household-b', collectionSlug: 'guest-uploads', ownerGuestId: GUEST_B, ownerHouseholdId: 'HOUSEB', visibility: 'household', caption: 'Bravo household only supper' },
    { ref: 'hidden-from-me', collectionSlug: 'guest-uploads', ownerGuestId: GUEST_B, ownerHouseholdId: 'HOUSEB', visibility: 'private', caption: 'Secret zebra manuscript' },
    { ref: 'unpublished', collectionSlug: 'guest-uploads', ownerGuestId: GUEST_B, ownerHouseholdId: 'HOUSEB', status: 'private', caption: 'Unpublished walrus rehearsal' },
    { ref: 'quarantined', collectionSlug: 'guest-uploads', ownerGuestId: GUEST_B, ownerHouseholdId: 'HOUSEB', status: 'quarantined', caption: 'Quarantined ocelot banner' },
    { ref: 'admin-only', collectionSlug: 'raw-archive', source: 'professional', vendor: 'oakhouse-visuals', caption: 'Raw archive tapir masters', rights: { vendorName: 'Oakhouse Visuals', allowAiProcessing: false } },
    { ref: 'pro', collectionSlug: 'full-ceremony', source: 'professional', vendor: 'brooke-alaina-photography', caption: 'Ceremony processional narwhal', rights: { vendorName: 'Brooke Alaina Photography', allowAiProcessing: false } },
  ], new Date());
  return { storage, spy, corpus, dir };
}

export async function call<T>(principal: Principal, name: string, input?: unknown, opts: { idempotencyKey?: string } = {}) {
  const ctx = await createCapabilityContext({
    principal, requestId: newId(), surface: 'ui',
    ...(principal.kind === 'anonymous' ? {} : { idempotencyKey: opts.idempotencyKey ?? newId() }),
  });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
}

export async function callOn<T>(principal: Principal, surface: 'ui' | 'ai' | 'webmcp', name: string, input?: unknown) {
  const ctx = await createCapabilityContext({ principal, requestId: newId(), surface, ...(principal.kind === 'anonymous' ? {} : { idempotencyKey: newId() }) });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
}

export async function post<T>(action: string, body: Record<string, unknown>, principal: 'guestA' | 'guestB' | 'anon' = 'guestA', extraHeaders: Record<string, string> = {}) {
  const specs: Record<string, unknown> = {
    guestA: { kind: 'guest', guestId: GUEST_A, householdId: 'HOUSEA', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] },
    guestB: { kind: 'guest', guestId: GUEST_B, householdId: 'HOUSEB', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] },
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

export async function setFlag(on: boolean) {
  if (on) process.env.FLAG_BIOMETRICS_ENABLED = 'on';
  else delete process.env.FLAG_BIOMETRICS_ENABLED;
}

export async function setReady(ready: boolean) {
  const db = await getDb();
  await setReadiness(db, { flag: 'BIOMETRICS_ENABLED', ready, actor: { kind: 'system', component: 'review-I' }, requestId: newId(), audit: await getAuditSink() });
  invalidateReadinessCache();
}

/** Draft + grant through the consent endpoint (the only door that writes the ledger). */
export async function grantThroughEndpoint(who: 'guestA' | 'guestB' = 'guestA') {
  const { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH } = await import('@/domain/biometrics');
  const draft = await post<{ policy: { version: string; textHash: string } }>('draft', { input: { adultAttested: true } }, who);
  expect(draft.ok, JSON.stringify(draft)).toBe(true);
  const token = draft.confirmation!.token;
  const granted = await post('grant', { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true }, confirmationToken: token, idempotencyKey: newId() }, who);
  expect(granted.ok, JSON.stringify(granted)).toBe(true);
  return granted;
}
