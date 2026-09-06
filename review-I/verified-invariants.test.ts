import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MyBiometricConsent } from '@/capabilities/biometrics';
import type { SearchMediaResult } from '@/capabilities/mediaai';
import { newId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { biometricConsents, biometricDeletions, biometricIdentityRefs, biometricMatches } from '@/db/schema/biometrics';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT_HASH, getConsentState, resolveVaultKey, sealTemplate, openTemplate } from '@/domain/biometrics';
import { runDueJobs } from '@/lib/jobs';
import { admin, anon, buildRig, call, callOn, GUEST_A, grantThroughEndpoint, guestA, guestB, post, setFlag, setReady, type Rig } from './harness';

/** Invariants that HOLD. These pass; they are the evidence behind the "no finding" verdicts. */
describe('verified invariants', () => {
  let rig: Rig;

  beforeAll(async () => {
    rig = await buildRig();
  });

  afterAll(async () => {
    await setFlag(false);
    await setReady(false);
  });

  describe('I2 — withdrawal survives every hostile precondition', () => {
    beforeAll(async () => {
      await setFlag(true);
      await setReady(true);
      await grantThroughEndpoint('guestA');
      expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
    });

    it('a guest with no entitlement, a stale session, the flag off AND readiness off can still withdraw and delete', async () => {
      const db = await getDb();
      await setFlag(false);
      await setReady(false);
      const hostile: GuestPrincipal = {
        ...guestA,
        entitlements: new Set([]), // every entitlement revoked, including use_face_matching
        authenticatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // six hours stale
      };
      const revoked = await call<{ revoked: boolean; deletion: { id: string } }>(hostile, 'revoke_biometric_consent', {});
      expect(revoked.ok, JSON.stringify(revoked)).toBe(true);
      if (!revoked.ok) return;
      expect(revoked.data.revoked).toBe(true);
      expect((await getConsentState(db, GUEST_A)).status).toBe('revoked');

      const deletion = await call<{ deletion: { id: string } }>(hostile, 'request_biometric_deletion', {});
      expect(deletion.ok).toBe(true);
      for (let i = 0; i < 3; i++) await runDueJobs(db, { worker: 'review-I', limit: 50 });
      expect(await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A))).toHaveLength(0);
      expect(await db.select().from(biometricMatches).where(eq(biometricMatches.guestId, GUEST_A))).toHaveLength(0);
      const completed = (await db.select().from(biometricDeletions).where(eq(biometricDeletions.guestId, GUEST_A))).every((d) => d.status === 'completed');
      expect(completed).toBe(true);
    });

    it('the HTTP consent endpoints answer with the flag and readiness both off', async () => {
      const revoke = await post('revoke', { input: {}, idempotencyKey: newId() });
      const del = await post('delete', { input: {}, idempotencyKey: newId() });
      expect([revoke.status, del.status]).toEqual([200, 200]);
    });
  });

  describe('I1/I6 — nothing biometric without all three gates; grants need a human on the website', () => {
    beforeAll(async () => {
      await setFlag(true);
      await setReady(true);
      const db = await getDb();
      await db.delete(biometricConsents);
    });

    it('the AI and WebMCP surfaces cannot see any biometric capability', async () => {
      rig.spy.reset();
      for (const name of ['draft_biometric_consent', 'grant_biometric_consent', 'revoke_biometric_consent', 'request_biometric_deletion', 'enroll_biometric_reference', 'find_photos_of_me', 'get_my_biometric_consent', 'admin_biometric_status', 'admin_set_biometric_readiness']) {
        for (const surface of ['ai', 'webmcp'] as const) {
          const r = await callOn(guestA, surface, name, {});
          expect(r.ok, `${name}@${surface}`).toBe(false);
          if (!r.ok) expect(r.error.code, `${name}@${surface}`).toBe('not_found');
        }
      }
      expect(rig.spy.biometricWork).toBe(0);
    });

    it('a confirmation token is single use and cannot be forged, stolen or re-pointed', async () => {
      const db = await getDb();
      const draft = await post<unknown>('draft', { input: { adultAttested: true } });
      const token = draft.confirmation!.token;
      const body = { input: { policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true } };

      // Tampered signature.
      const forged = `${token.split('.')[0]}.${'a'.repeat(64)}`;
      const bad = await post('grant', { ...body, confirmationToken: forged, idempotencyKey: newId() });
      expect(bad.ok).toBe(false);
      expect(bad.error?.code).toBe('confirmation_required');

      // Another guest cannot redeem it.
      const stolen = await post('grant', { ...body, confirmationToken: token, idempotencyKey: newId() }, 'guestB');
      expect(stolen.ok).toBe(false);

      // The rightful guest redeems it once...
      const first = await post('grant', { ...body, confirmationToken: token, idempotencyKey: newId() });
      expect(first.ok, JSON.stringify(first)).toBe(true);
      // ...and the nonce is burnt for any later attempt.
      await db.delete(biometricConsents); // even with the ledger reset, the token is spent
      const replay = await post('grant', { ...body, confirmationToken: token, idempotencyKey: newId() });
      expect(replay.ok).toBe(false);
      expect(replay.error?.details?.['reason']).toBe('used');
    });

    it('grant_biometric_consent has no guest selector, so nobody can consent for anyone else', async () => {
      const { grantBiometricConsent } = await import('@/capabilities/biometrics');
      const shape = grantBiometricConsent.input.safeParse({ policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, adultAttested: true, guestId: 'GUESTB' });
      expect(shape.success).toBe(true);
      if (shape.success) expect(Object.keys(shape.data as object)).toEqual(['policyVersion', 'textHash', 'adultAttested']);
      // Household managers act for their household elsewhere; here actsFor is never consulted.
      const manager: GuestPrincipal = { ...guestA, actsFor: [guestA.guestId, guestB.guestId] };
      const view = await call<MyBiometricConsent>(manager, 'get_my_biometric_consent', {});
      expect(view.ok && view.data.enrolment).toBeNull();
    });

    it('admins and system principals cannot do a guest\'s biometric work for them', async () => {
      for (const name of ['enroll_biometric_reference', 'find_photos_of_me']) {
        const input = name === 'find_photos_of_me' ? { candidateAssetIds: [rig.corpus.get('mine-1')!.assetId] } : { assetIds: [rig.corpus.get('mine-1')!.assetId] };
        const r = await call(admin, name, input);
        expect(r.ok, name).toBe(false);
      }
      const r = await call(admin, 'get_my_biometric_consent', {});
      expect(r.ok).toBe(false);
      expect((await call(anon, 'get_my_biometric_consent', {})).ok).toBe(false);
    });
  });

  describe('I4/I9 — the vault stays sealed and out of every output', () => {
    it('a missing BIOMETRIC_VAULT_KEY fails closed in production and never falls back to plaintext', () => {
      // (F9 fixed: the refusal reason is now `missing_key`, because the refusal is no longer only
      // about production — the two cases below are the finding's point.)
      expect(resolveVaultKey({ isProduction: true })).toEqual({ ok: false, reason: 'missing_key' });
      // ...and anywhere the feature could actually run: staging, a preview, a local copy with real
      // data. Only NODE_ENV=test may seal a fixture template under a derived key.
      expect(resolveVaultKey({ isProduction: false, biometricsEnabled: true, CONFIRMATION_SECRET: 'x'.repeat(32) })).toEqual({ ok: false, reason: 'missing_key' });
      expect(resolveVaultKey({ isProduction: false, biometricsEnabled: true, isTest: true, CONFIRMATION_SECRET: 'x'.repeat(32) }).ok).toBe(true);
      const dev = resolveVaultKey({ isProduction: false, CONFIRMATION_SECRET: 'x'.repeat(32) });
      expect(dev.ok).toBe(true);
      if (!dev.ok) return;
      const sealed = sealTemplate(dev.key, [0.1, 0.2, 0.3]);
      expect(sealed).not.toContain('0.1');
      const other = resolveVaultKey({ isProduction: false, CONFIRMATION_SECRET: 'y'.repeat(32) });
      expect(other.ok && openTemplate(other.key, sealed)).toBeNull();
    });

    it('no guest- or admin-facing output ever contains a template, key id, IP hash or provider subject', async () => {
      await setFlag(true);
      await setReady(true);
      const db = await getDb();
      await db.delete(biometricConsents);
      await grantThroughEndpoint('guestA');
      expect((await call(guestA, 'enroll_biometric_reference', { assetIds: [rig.corpus.get('mine-1')!.assetId] })).ok).toBe(true);
      const ref = (await db.select().from(biometricIdentityRefs).where(eq(biometricIdentityRefs.guestId, GUEST_A)))[0]!;
      const consent = (await db.select().from(biometricConsents).where(eq(biometricConsents.guestId, GUEST_A)))[0]!;
      const outputs = [
        JSON.stringify((await call<unknown>(guestA, 'get_my_biometric_consent', {})).ok),
        JSON.stringify(await call<unknown>(guestA, 'get_my_biometric_consent', {})),
        JSON.stringify(await call<unknown>(admin, 'admin_biometric_status', {})),
        JSON.stringify(await call<unknown>(admin, 'admin_media_ai_status', {})),
        JSON.stringify(await call<unknown>(guestA, 'search_media', { query: 'reception' })),
        JSON.stringify(await call<unknown>(guestA, 'suggest_alt_text', { assetId: rig.corpus.get('mine-1')!.assetId })),
      ].join('\n');
      for (const secret of [ref.templateSealed, ref.templateKeyId, ref.subjectId === GUEST_A ? 'templateSealed' : ref.subjectId, consent.ipHash!]) {
        expect(outputs, `leaked: ${secret.slice(0, 24)}`).not.toContain(secret);
      }
      // ...and a vault-key mismatch surfaces as a generic internal error, never as a cause string.
      const failure = JSON.stringify(await call<unknown>(guestA, 'find_photos_of_me', { candidateAssetIds: ['00000000000000000000000000'] }));
      expect(failure).not.toContain('vault');
    });

    it('with the feature off the guest view carries no consent copy at all', async () => {
      await setFlag(false);
      await setReady(false);
      const view = await call<MyBiometricConsent>(guestA, 'get_my_biometric_consent', {});
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(view.data.policy).toBeNull();
      const s = JSON.stringify(view.data);
      for (const phrase of ['biometric identifier', 'numeric face template', 'Illinois', '18 or older']) expect(s).not.toContain(phrase);
    });
  });

  describe('I7 — search returns only what the caller may see', () => {
    beforeAll(async () => {
      expect((await call(admin, 'admin_reindex_media', { full: true })).ok).toBe(true);
      const db = await getDb();
      for (let i = 0; i < 5; i++) await runDueJobs(db, { worker: 'review-I', limit: 300 });
    });

    const secrets: [string, string][] = [
      ['hidden-from-me', 'zebra manuscript'],
      ['unpublished', 'walrus rehearsal'],
      ['quarantined', 'ocelot banner'],
      ['household-b', 'Bravo household supper'],
    ];

    it('anonymous visitors cannot reach private, unpublished, quarantined or other-household items', async () => {
      for (const [ref, query] of secrets) {
        const r = await callOn<SearchMediaResult>(anon, 'ui', 'search_media', { query });
        expect(r.ok, query).toBe(true);
        if (!r.ok) continue;
        expect(r.data.items.map((i) => i.id), `${ref} via anonymous search`).not.toContain(rig.corpus.get(ref)!.assetId);
        expect(JSON.stringify(r.data.items), `${ref} content echoed back`).not.toContain(query.split(' ')[1]!);
      }
    });

    it('a signed-in guest cannot reach another household\'s private or unpublished items, on any surface', async () => {
      for (const [ref, query] of secrets) {
        for (const surface of ['ui', 'ai', 'webmcp'] as const) {
          const r = await callOn<SearchMediaResult>(guestA, surface, 'search_media', { query });
          expect(r.ok, `${query}@${surface}`).toBe(true);
          if (!r.ok) continue;
          expect(r.data.items.map((i) => i.id), `${ref}@${surface}`).not.toContain(rig.corpus.get(ref)!.assetId);
        }
      }
    });

    it('an admin-only collection is unreachable, and its slug is not an oracle', async () => {
      const secret = rig.corpus.get('admin-only')!.assetId;
      for (const principal of [anon, guestA] as const) {
        const direct = await callOn<SearchMediaResult>(principal, 'ui', 'search_media', { query: 'tapir masters' });
        expect(direct.ok).toBe(true);
        if (direct.ok) expect(direct.data.items.map((i) => i.id)).not.toContain(secret);
        const scoped = await callOn<SearchMediaResult>(principal, 'ui', 'search_media', { query: 'tapir masters', collection: 'raw-archive' });
        const bogus = await callOn<SearchMediaResult>(principal, 'ui', 'search_media', { query: 'tapir masters', collection: 'no-such-album' });
        expect(scoped.ok && bogus.ok).toBe(true);
        if (scoped.ok && bogus.ok) {
          expect(scoped.data.items).toHaveLength(0);
          // Same shape for a real-but-forbidden album and an album that does not exist.
          expect({ ...scoped.data, query: '' }).toEqual({ ...bogus.data, query: '' });
        }
      }
      // The admin, who may see it, does.
      const asAdmin = await callOn<SearchMediaResult>(admin, 'ui', 'search_media', { query: 'tapir masters' });
      expect(asAdmin.ok && asAdmin.data.items.map((i) => i.id)).toContain(secret);
    });

    it('the collection filter is not an oracle and the "why it matched" list never quotes an invisible item', async () => {
      const r = await callOn<SearchMediaResult>(anon, 'ui', 'search_media', { query: 'zebra manuscript ocelot walrus', collection: 'guest-uploads' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.items.flatMap((i) => i.matchedTerms)).not.toContain('zebra');
      expect(r.data.items.flatMap((i) => i.matchedTerms)).not.toContain('ocelot');
    });

    it('suggest_alt_text refuses a non-owner guest and never reveals that the asset exists', async () => {
      const r = await call(guestA, 'suggest_alt_text', { assetId: rig.corpus.get('hidden-from-me')!.assetId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('not_found');
      const missing = await call(guestA, 'suggest_alt_text', { assetId: '00000000000000000000000000' });
      expect(missing.ok).toBe(false);
      if (!missing.ok && !r.ok) expect(missing.error.message).toBe(r.error.message);
    });
  });
});
