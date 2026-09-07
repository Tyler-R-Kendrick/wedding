import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { adminAssignTransportationEntitlement, adminListTransportationEntitlements, adminRevokeTransportationEntitlement, adminUploadTransportationCodes } from '@/capabilities/admin_transport';
import { claimMyTransportationBenefit } from '@/capabilities/claim_my_transportation_benefit';
import { draftMyTransportationClaim } from '@/capabilities/draft_my_transportation_claim';
import { getMyTransportationOptions } from '@/capabilities/get_my_transportation_options';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId, IdempotencyKey } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import { toPrincipalRef, type AdminPrincipal, type GuestPrincipal, type Principal } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { getDb } from '@/db/client';
import { FX } from '@/db/seed/fixtures';
import { externalActionRecords, guests, transportationClaims, transportationManualCodes } from '@/db/schema';
import { DbManualCodeSource } from '@/domain/transport/manual-codes';
import { getTransportVault } from '@/domain/external/vault';
import { listAuditEvents } from '@/lib/audit';
import { stableHash } from '@/lib/crypto';
import { getConfirmationService } from '@/policy/confirmation';
import { failure } from '@/providers/base';
import { resetProviders, setProviderOverride } from '@/providers/registry';
import { seedSwarmE } from './helpers/swarm-e';
import { ManualCodeTransportBenefit, MockTransportBenefit } from '@/providers/transport-benefit';
import type { VoucherClaimRequest } from '@/providers/transport-benefit/types';

/*
 * Seeded fixture guests, not freshly minted ids. `transportation_entitlements` and
 * `transportation_claims` carry real foreign keys to `guests` as of this integration, so a synthetic
 * id is refused by the database before any guard under test runs — which is exactly what happened
 * when the constraints went on. The fixture households already provide the shape these cases need,
 * including a real minor (Cleo, `isMinor: true`) rather than one asserted into existence.
 */
const H1 = FX.householdA;
const H2 = FX.householdB;
const G1 = FX.guestA2; // household 1, adult
const G2 = FX.guestA1; // household 1, manager who acts for G1 (RSVP), still may not claim G1's benefit
const G3 = FX.guestA3; // household 1, minor
const G4 = FX.guestB1; // household 2
const G5 = FX.guestB2; // household 2, manual-code pool exhausted

function guest(guestId: GuestId, householdId: HouseholdId, over: Partial<GuestPrincipal> = {}): GuestPrincipal {
  return {
    kind: 'guest',
    authIdentityId: `auth-${guestId}` as AuthIdentityId,
    guestId,
    householdId,
    actsFor: [guestId],
    entitlements: new Set(['claim_transportation_benefit', 'view_travel_tools', 'rsvp_self']),
    authenticatedAt: new Date().toISOString(),
    sessionId: `s-${guestId}`,
    ...over,
  };
}
const admin: AdminPrincipal = {
  kind: 'admin',
  authIdentityId: 'auth-admin' as AuthIdentityId,
  adminId: 'ADMIN1' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(['admin_guest_ops', 'admin_integrations', 'admin_content', 'admin_audit']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's-admin',
};

let requestCounter = 0;
async function run<I, O>(descriptor: Parameters<typeof invoke<I, O>>[0], principal: Principal, input: unknown, extra: { idempotencyKey?: string; confirmationToken?: string; surface?: 'ui' | 'ai' | 'webmcp'; requestId?: string } = {}) {
  const ctx = await createCapabilityContext({ principal, requestId: extra.requestId ?? `req-tc-${++requestCounter}`, surface: extra.surface ?? 'ui', idempotencyKey: extra.idempotencyKey, confirmationToken: extra.confirmationToken });
  return invoke(descriptor, ctx, input);
}
const key = () => newId<IdempotencyKey>();

async function tokenFor(principal: GuestPrincipal, entitlementId: string, surface: 'ui' | 'ai' = 'ui') {
  const c = await getConfirmationService();
  return c.issue({ capability: 'claim_my_transportation_benefit', principalRef: toPrincipalRef(principal), payloadHash: stableHash({ entitlementId }), surface }).token;
}

/** Counts provider calls so replay tests can prove the handler ran once. */
class CountingMock extends MockTransportBenefit {
  calls = 0;
  override async createVoucherClaim(req: VoucherClaimRequest) {
    this.calls++;
    return super.createVoucherClaim(req);
  }
}

class FailingMock extends MockTransportBenefit {
  override async createVoucherClaim(_req: VoucherClaimRequest) {
    return err(failure('mock', 'timeout', 'The ride provider took too long to answer.'));
  }
}

let counting: CountingMock;
let E1: string;
let E3: string;
let E4: string;
let E5: string;
let redemptionUrl: string;

/** Inserts a real guest row so a foreign key can point at it. */
async function makeGuest(firstName: string, householdId: HouseholdId): Promise<GuestId> {
  const id = newId<GuestId>();
  await (await getDb()).insert(guests).values({ id, householdId, firstName, lastName: 'Fixture' }).onConflictDoNothing();
  return id;
}

beforeAll(async () => {
  // Seeds events then the fixture households; `event_entitlements` references `events`, so the
  // order matters.
  await seedSwarmE();
  MockTransportBenefit.reset();
  counting = new CountingMock();
  setProviderOverride('transport-benefit', counting);
  const assign = async (guestId: GuestId, householdId: HouseholdId, extra: Record<string, unknown> = {}) => {
    const r = await run(adminAssignTransportationEntitlement, admin, { guestId, householdId, amountNote: 'TODO(Tyler & Sara): amount', validityNote: 'Wedding night', geofenceNote: 'Chicago', ...extra }, { idempotencyKey: key() });
    if (!r.ok) throw r.error;
    return r.value.data.id;
  };
  E1 = await assign(G1, H1);
  E3 = await assign(G3, H1, { guestIsMinor: true });
  E4 = await assign(G4, H2);
  E5 = await assign(G5, H2);
});
afterAll(() => resetProviders());

describe('ride benefit claims', () => {
  it('assigns via admin and shows the benefit as eligible only to its owner', async () => {
    const mine = await run(getMyTransportationOptions, guest(G1, H1), {});
    // The notes are admin free text rendered to the guest verbatim, and every one of these
    // entitlements was assigned with the authoring marker as its amount — an admin saying the
    // planner has not confirmed it. The guest read must hand back `null`, which every surface
    // renders as "To be confirmed"; this used to assert the marker came back intact, which is how
    // `TODO(Tyler & Sara): amount` came to be printed on a guest's ride card.
    expect(mine.ok && mine.value.data).toMatchObject({ signedIn: true, benefits: [{ entitlementId: E1, status: 'eligible', amountNote: null, validityNote: 'Wedding night' }] });
    expect(JSON.stringify(mine.ok && mine.value.data.benefits)).not.toContain('TODO(');
    const manager = await run(getMyTransportationOptions, guest(G2, H1, { actsFor: [G2, G1, G3] }), {});
    expect(manager.ok && manager.value.data.benefits).toEqual([]); // individuals own benefits, even inside a household
    const other = await run(getMyTransportationOptions, guest(G4, H2), {});
    expect(other.ok && other.value.data.benefits.map((b) => b.entitlementId)).toEqual([E4]);
    const anon = await run(getMyTransportationOptions, { kind: 'anonymous' }, {});
    expect(anon.ok && anon.value.data).toMatchObject({ signedIn: false, benefits: [] });
    expect(anon.ok && anon.value.data.topics.length).toBeGreaterThan(2);
  });

  it('drafts a payload-bound confirmation, claims once, and never returns the secret from the transaction', async () => {
    const g1 = guest(G1, H1);
    const draftA = await run(draftMyTransportationClaim, g1, { entitlementId: E1 });
    expect(draftA.ok).toBe(true);
    if (!draftA.ok) return;
    expect(draftA.value.data).toMatchObject({ claimable: true, provider: { name: 'mock', testMode: true, redemptionKind: 'link' }, confirmInput: { entitlementId: E1 } });
    expect(draftA.value.confirmation?.token).toBeTruthy();
    // A second tab drafted too (its token is used later to prove a double claim returns the first result).
    const draftB = await run(draftMyTransportationClaim, g1, { entitlementId: E1 });
    const k1 = key();
    const claim = await run(claimMyTransportationBenefit, g1, { entitlementId: E1 }, { idempotencyKey: k1, confirmationToken: draftA.value.confirmation!.token, requestId: 'req-claim-1' });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.data).toMatchObject({ entitlementId: E1, status: 'issued', provider: 'mock', redemptionKind: 'link', revealRoute: '/transportation' });
    expect(JSON.stringify(claim.value)).not.toMatch(/uber\.com\/redeem/);
    expect(counting.calls).toBe(1);

    // The owner reads the link on the ui surface; every other surface gets a pointer to the page.
    const ui = await run(getMyTransportationOptions, g1, {});
    const b = ui.ok ? ui.value.data.benefits[0]! : undefined;
    expect(b).toMatchObject({ status: 'claimed', claim: { claimId: claim.value.data.claimId, provider: 'mock', testMode: true }, redemption: { kind: 'link', host: 'www.uber.com', providerDisplayName: 'Uber', label: 'Open in Uber' } });
    redemptionUrl = b!.redemption!.kind === 'link' ? b!.redemption!.url : '';
    expect(redemptionUrl).toMatch(/^https:\/\/www\.uber\.com\/redeem\//);
    for (const surface of ['ai', 'webmcp'] as const) {
      const r = await run(getMyTransportationOptions, g1, {}, { surface });
      expect(r.ok && r.value.data.benefits[0]!.redemption).toMatchObject({ kind: 'hidden', revealRoute: '/transportation' });
      expect(JSON.stringify(r)).not.toContain(redemptionUrl);
    }

    // Idempotent double-claim: same key replays; a fresh key with the second tab's token returns the first result.
    const replay = await run(claimMyTransportationBenefit, g1, { entitlementId: E1 }, { idempotencyKey: k1, confirmationToken: draftA.value.confirmation!.token });
    expect(replay.ok && replay.value.data.claimId).toBe(claim.value.data.claimId);
    const again = await run(claimMyTransportationBenefit, g1, { entitlementId: E1 }, { idempotencyKey: key(), confirmationToken: draftB.ok ? draftB.value.confirmation!.token : '' });
    expect(again.ok && again.value.data.claimId).toBe(claim.value.data.claimId);
    expect(counting.calls).toBe(1);
    // Once claimed, a new draft is no longer claimable and issues no token.
    const draftC = await run(draftMyTransportationClaim, g1, { entitlementId: E1 });
    expect(draftC.ok && draftC.value.data.claimable).toBe(false);
    expect(draftC.ok && draftC.value.confirmation).toBeUndefined();
  });

  it('enforces one claim per entitlement in the database itself', async () => {
    const db = await getDb();
    let thrown: unknown;
    try {
      await db.insert(transportationClaims).values({ id: newId(), entitlementId: E1, guestId: G1, householdId: H1, status: 'pending', providerName: 'mock', requestId: 'req-dup' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const cause = (thrown as Error & { cause?: Error }).cause;
    expect(`${(thrown as Error).message} ${cause?.message ?? ''}`).toMatch(/unique|duplicate/i);
    expect(await db.select().from(transportationClaims)).toHaveLength(1);
  });

  it('audits the claim and the external action without the redemption link, anywhere', async () => {
    const db = await getDb();
    const claimed = await listAuditEvents(db, { action: 'transport.claimed' });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.metadata).toMatchObject({ entitlementId: E1, provider: 'mock', issuedAs: 'link' });
    const everything = await listAuditEvents(db, { limit: 1000 });
    expect(JSON.stringify(everything)).not.toContain(redemptionUrl);
    expect(JSON.stringify(everything)).not.toMatch(/uber\.com\/redeem/);
    const records = await db.select().from(externalActionRecords);
    const rec = records.find((r) => r.kind === 'transport_claim');
    expect(rec).toMatchObject({ status: 'committed', provider: 'mock', urlHost: 'www.uber.com', surface: 'ui' });
    expect(JSON.stringify(records)).not.toMatch(/uber\.com\/redeem/);
    const invoked = await listAuditEvents(db, { requestId: 'req-claim-1' });
    expect(invoked.map((e) => e.action).sort()).toEqual(['capability.invoked', 'external_action.confirmed', 'transport.claimed']);
    expect(invoked.find((e) => e.action === 'capability.invoked')!.metadata).toMatchObject({ kind: 'transaction', surface: 'ui', inputHash: expect.any(String) });
  });

  it('denies a cross-household claim and a same-household manager, even with a valid token', async () => {
    const g4 = guest(G4, H2);
    const cross = await run(claimMyTransportationBenefit, g4, { entitlementId: E1 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E1) });
    expect(!cross.ok && cross.error.code).toBe('forbidden');
    const g2 = guest(G2, H1, { actsFor: [G2, G1, G3] });
    const manager = await run(claimMyTransportationBenefit, g2, { entitlementId: E1 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g2, E1) });
    expect(!manager.ok && manager.error.code).toBe('forbidden');
    expect((await run(draftMyTransportationClaim, g4, { entitlementId: E1 })).ok).toBe(false);
    const denied = await listAuditEvents(await getDb(), { action: 'transport.claim_failed' });
    expect(denied.filter((e) => e.outcome === 'denied' && e.metadata?.reason === 'not_owner').length).toBeGreaterThanOrEqual(2);
    // Their own reads never include the other guest's benefit or link.
    const theirs = await run(getMyTransportationOptions, g4, {});
    expect(JSON.stringify(theirs)).not.toContain(E1);
    expect(JSON.stringify(theirs)).not.toContain(redemptionUrl);
  });

  it('refuses unauthenticated, stale, unentitled, ineligible, model-surface and unknown claims', async () => {
    const g4 = guest(G4, H2);
    const anon = await run(claimMyTransportationBenefit, { kind: 'anonymous' }, { entitlementId: E4 });
    expect(!anon.ok && anon.error.code).toBe('unauthenticated');
    const stale = await run(claimMyTransportationBenefit, guest(G4, H2, { authenticatedAt: '2020-01-01T00:00:00Z' }), { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4) });
    expect(!stale.ok && stale.error.code).toBe('step_up_required');
    const unentitled = await run(claimMyTransportationBenefit, guest(G4, H2, { entitlements: new Set(['rsvp_self']) }), { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4) });
    expect(!unentitled.ok && unentitled.error.code).toBe('forbidden');
    const g3 = guest(G3, H1);
    const minorDraft = await run(draftMyTransportationClaim, g3, { entitlementId: E3 });
    expect(minorDraft.ok && minorDraft.value.data).toMatchObject({ claimable: false, benefit: { status: 'ineligible' } });
    const minor = await run(claimMyTransportationBenefit, g3, { entitlementId: E3 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g3, E3) });
    expect(!minor.ok && minor.error).toMatchObject({ code: 'forbidden', details: { reason: 'minor' } });
    for (const surface of ['ai', 'webmcp'] as const) {
      const model = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4), surface });
      expect(!model.ok && model.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
    }
    const aiToken = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4, 'ai') });
    expect(!aiToken.ok && aiToken.error.details?.reason).toBe('requires_ui');
    const missingKey = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { confirmationToken: await tokenFor(g4, E4) });
    expect(!missingKey.ok && missingKey.error.message).toBe('idempotencyKey required');
    const unknownId = newId();
    const unknown = await run(claimMyTransportationBenefit, g4, { entitlementId: unknownId }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, unknownId) });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('not_found');
    expect(counting.calls).toBe(1);
  });

  it('marks a provider failure, lets the guest retry, and then issues', async () => {
    const g4 = guest(G4, H2);
    setProviderOverride('transport-benefit', new FailingMock());
    const failed = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4) });
    expect(!failed.ok && failed.error.code).toBe('provider_unavailable');
    const view = await run(getMyTransportationOptions, g4, {});
    expect(view.ok && view.value.data.benefits[0]!.status).toBe('failed');
    setProviderOverride('transport-benefit', counting);
    const retry = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4) });
    expect(retry.ok && retry.value.data.status).toBe('issued');
    const db = await getDb();
    const failedRecord = (await db.select().from(externalActionRecords)).find((r) => r.kind === 'transport_claim' && r.status === 'failed');
    expect(failedRecord).toBeTruthy();
  });

  it('revoking hides the redemption and blocks new claims', async () => {
    const g4 = guest(G4, H2);
    const revoke = await run(adminRevokeTransportationEntitlement, admin, { entitlementId: E4 }, { idempotencyKey: key() });
    expect(revoke.ok && revoke.value.data.status).toBe('revoked');
    const view = await run(getMyTransportationOptions, g4, {});
    expect(view.ok && view.value.data.benefits[0]).toMatchObject({ status: 'revoked' });
    expect(view.ok && view.value.data.benefits[0]!.redemption).toBeUndefined();
    const claim = await run(claimMyTransportationBenefit, g4, { entitlementId: E4 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g4, E4) });
    expect(!claim.ok && claim.error.code).toBe('conflict');
    const guestRevoke = await run(adminRevokeTransportationEntitlement, g4, { entitlementId: E4 }, { idempotencyKey: key() });
    expect(!guestRevoke.ok && guestRevoke.error.code).toBe('forbidden');
  });

  it('manual-code mode: admin uploads sealed codes, a guest gets one, the pool empties honestly', async () => {
    const db = await getDb();
    setProviderOverride('transport-benefit', new ManualCodeTransportBenefit(new DbManualCodeSource({ db, vault: await getTransportVault() })));
    const upload = await run(adminUploadTransportationCodes, admin, { codes: ['RIDE-ABC-123', 'RIDE-ABC-123', 'x', ' RIDE-DEF-456 '] }, { idempotencyKey: key() });
    expect(upload.ok && upload.value.data).toMatchObject({ program: 'reception-ride-home', added: 2, duplicates: 1, rejected: 1 });
    const again = await run(adminUploadTransportationCodes, admin, { codes: ['RIDE-ABC-123'] }, { idempotencyKey: key() });
    expect(again.ok && again.value.data).toMatchObject({ added: 0, duplicates: 1 });
    const rows = await db.select().from(transportationManualCodes);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('RIDE-ABC');
    const guestUpload = await run(adminUploadTransportationCodes, guest(G5, H2), { codes: ['NOPE-1'] }, { idempotencyKey: key() });
    expect(!guestUpload.ok && guestUpload.error.code).toBe('forbidden');

    const g5 = guest(G5, H2);
    const draft = await run(draftMyTransportationClaim, g5, { entitlementId: E5 });
    expect(draft.ok && draft.value.data.provider).toMatchObject({ name: 'manual-code', redemptionKind: 'code', testMode: false });
    const claim = await run(claimMyTransportationBenefit, g5, { entitlementId: E5 }, { idempotencyKey: key(), confirmationToken: draft.ok ? draft.value.confirmation!.token : '' });
    expect(claim.ok && claim.value.data.redemptionKind).toBe('code');
    expect(JSON.stringify(claim)).not.toContain('RIDE-');
    const view = await run(getMyTransportationOptions, g5, {});
    expect(view.ok && view.value.data.benefits[0]!.redemption).toMatchObject({ kind: 'code', code: 'RIDE-ABC-123' });
    const issued = (await db.select().from(transportationManualCodes)).filter((r) => r.status === 'issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.claimId).toBe(claim.ok ? claim.value.data.claimId : '');
    const overview = await run(adminListTransportationEntitlements, admin, {});
    expect(overview.ok && overview.value.data.codePools).toEqual([{ program: 'reception-ride-home', available: 1, issued: 1 }]);
    expect(JSON.stringify(overview)).not.toMatch(/RIDE-|uber\.com\/redeem/);
    expect(overview.ok && overview.value.data.entitlements.find((e) => e.id === E5)?.claim).toMatchObject({ status: 'issued', redemptionKind: 'code' });

    // Exhaust the pool: the last code goes to a fresh entitlement, the next guest is told honestly.
    // Two extra bodies in household 2, created rather than asserted into existence: the foreign key
    // on `transportation_entitlements.guest_id` means a guest must actually exist, and the fixtures
    // supply only two in this household. What this case tests is pool exhaustion, not household
    // semantics, so a plain row each is the right shape.
    const G6 = await makeGuest('Pool', H2);
    const G7 = await makeGuest('Empty', H2);
    const e6 = await run(adminAssignTransportationEntitlement, admin, { guestId: G6, householdId: H2 }, { idempotencyKey: key() });
    const e7 = await run(adminAssignTransportationEntitlement, admin, { guestId: G7, householdId: H2 }, { idempotencyKey: key() });
    const E6 = e6.ok ? e6.value.data.id : '';
    const E7 = e7.ok ? e7.value.data.id : '';
    const g6 = guest(G6, H2);
    expect((await run(claimMyTransportationBenefit, g6, { entitlementId: E6 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g6, E6) })).ok).toBe(true);
    const g7 = guest(G7, H2);
    const empty = await run(claimMyTransportationBenefit, g7, { entitlementId: E7 }, { idempotencyKey: key(), confirmationToken: await tokenFor(g7, E7) });
    expect(!empty.ok && empty.error.code).toBe('not_found');
    expect(!empty.ok && empty.error.message).toMatch(/No ride codes/);
    const v7 = await run(getMyTransportationOptions, g7, {});
    expect(v7.ok && v7.value.data.benefits[0]!.status).toBe('failed');
    const list = await run(adminListTransportationEntitlements, guest(G1, H1), {});
    expect(!list.ok && list.error.code).toBe('forbidden');
  });

  it('ok() helper sanity: results are plain envelopes', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });
});
