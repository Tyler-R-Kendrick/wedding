import { isPlaceholderText } from '@/content/schemas';
import type { AuditSink } from '@/contracts/audit';
import type { CapabilityExposure } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import { toPrincipalRef, type GuestPrincipal, type Principal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import type { TransportationClaimRow, TransportationEntitlementRow } from '@/db/schema';
import { toCapabilityError } from '@/providers/base';
import type { MapsProvider } from '@/providers/maps/types';
import type { TransportBenefitProvider } from '@/providers/transport-benefit/types';
import { hostOf, providerDisplayName, toGuestHandoff, type GuestHandoff } from '../external/handoff';
import { recordExternalAction } from '../external/records';
import type { Vault } from '../external/vault';
import { TRANSPORTATION_TOPICS, VALET_ENTRANCE, VENUE_PLACE, type TransportationTopic } from './content';
import { ELIGIBILITY_MESSAGES, getTransportEligibilityFactSource } from './eligibility';
import { getClaimForEntitlement, getEntitlement, insertPendingClaim, listEntitlementsForGuest, markClaimFailed, markClaimIssued, markClaimPending } from './repo';

export type BenefitStatus = 'eligible' | 'claimed' | 'pending' | 'failed' | 'ineligible' | 'revoked' | 'expired' | 'not_yet_valid' | 'unavailable';

export type Redemption =
  | { kind: 'link'; label: string; providerDisplayName: string; url: string; host: string; disclosure: string; expiresAt?: string }
  | { kind: 'code'; code: string; instructions: string; expiresAt?: string }
  /** Non-ui surfaces (concierge, WebMCP) never receive the secret; they point the guest at the page. */
  | { kind: 'hidden'; revealRoute: '/transportation'; note: string };

export interface BenefitView {
  entitlementId: string;
  program: string;
  status: BenefitStatus;
  statusMessage: string;
  amountNote: string | null;
  validityNote: string | null;
  geofenceNote: string | null;
  verifiedAt: string | null;
  claim?: { claimId: string; claimedAt: string | null; provider: string; providerDisplayName: string; testMode: boolean };
  redemption?: Redemption;
}

export interface ClaimOutcome {
  claimId: string;
  entitlementId: string;
  status: 'issued';
  provider: string;
  providerDisplayName: string;
  testMode: boolean;
  claimedAt: string;
  expiresAt?: string;
  redemption: Extract<Redemption, { kind: 'link' | 'code' }>;
}

const REDEMPTION_DISCLOSURE = 'You will leave our site and open your ride credit in the Uber app. We never see your Uber account or payment details.';
const CODE_INSTRUCTIONS = 'Enter this code in the Uber app under Wallet → Add promo code. It is personal to you; please do not share it.';

const isTestProvider = (name: string) => name === 'mock';

function windowStatus(e: TransportationEntitlementRow, now: Date): BenefitStatus | undefined {
  if (e.status === 'revoked') return 'revoked';
  if (e.validFrom && now < e.validFrom) return 'not_yet_valid';
  if (e.validUntil && now > e.validUntil) return 'expired';
  return undefined;
}

const STATUS_MESSAGES: Record<BenefitStatus, string> = {
  eligible: 'A ride benefit is ready for you to claim.',
  claimed: 'Your ride benefit is claimed. It is personal to you.',
  pending: 'Your claim is being processed. Please check back in a moment.',
  failed: 'We could not finish your claim. You can try again, or ask us for help.',
  ineligible: 'This benefit is not available for this guest.',
  revoked: 'This benefit is no longer active. Please ask us if you think that is a mistake.',
  expired: 'This benefit has expired.',
  not_yet_valid: 'This benefit will become available closer to the wedding.',
  unavailable: 'Ride benefits are not available right now.',
};

/** Unseals a claim's secret for its owner. Only ever called with the owner's principal on the ui surface. */
export function redemptionFor(claim: TransportationClaimRow, vault: Vault, surface: keyof CapabilityExposure): Redemption | undefined {
  if (claim.status !== 'issued' || !claim.secretCiphertext) return undefined;
  if (surface !== 'ui') return { kind: 'hidden', revealRoute: '/transportation', note: 'Open the Transportation page on the website to see your ride credit.' };
  const secret = vault.unseal(claim.secretCiphertext);
  if (!secret.ok) return undefined;
  const expiresAt = claim.expiresAt?.toISOString();
  if (claim.redemptionKind === 'link') {
    const handoff = toGuestHandoff({ provider: claim.providerName, label: 'Open in Uber', url: secret.value, opensNewTab: true, disclosure: REDEMPTION_DISCLOSURE });
    if (!handoff.ok) return undefined;
    return { kind: 'link', label: handoff.value.label, providerDisplayName: handoff.value.providerDisplayName, url: handoff.value.url, host: handoff.value.host, disclosure: handoff.value.disclosure, expiresAt };
  }
  return { kind: 'code', code: secret.value, instructions: CODE_INSTRUCTIONS, expiresAt };
}

/**
 * The three benefit notes are admin free text shown to the guest verbatim (see the help on the
 * admin form), and "verbatim" must stop at the authoring marker. An admin who types
 * `TODO(Tyler & Sara): amount` is saying the planner has not confirmed it — the honest render of
 * that is the "To be confirmed" the UI already shows for an unset note, not `TODO(...)` printed on
 * a guest's ride card. Nulling it here keeps that one decision in one place: `ClaimBenefitFlow`,
 * `RedemptionCard` and the plain page recipe all fall back to the same wording.
 */
const guestNote = (note: string | null) => (note && isPlaceholderText(note) ? null : note);

export async function benefitViewsFor(db: Db, vault: Vault, principal: GuestPrincipal, now: Date, surface: keyof CapabilityExposure): Promise<BenefitView[]> {
  const rows = await listEntitlementsForGuest(db, principal.guestId);
  const facts = getTransportEligibilityFactSource();
  const out: BenefitView[] = [];
  for (const e of rows) {
    // Defensive: the query is by guest id, but ownership is re-checked before anything personal is shown.
    if (e.guestId !== principal.guestId) continue;
    const base: BenefitView = {
      entitlementId: e.id,
      program: e.program,
      status: 'eligible',
      statusMessage: STATUS_MESSAGES.eligible,
      amountNote: guestNote(e.amountNote),
      validityNote: guestNote(e.validityNote),
      geofenceNote: guestNote(e.geofenceNote),
      verifiedAt: e.verifiedAt?.toISOString() ?? null,
    };
    const claim = await getClaimForEntitlement(db, e.id);
    const blocked = windowStatus(e, now);
    if (blocked) {
      out.push({ ...base, status: blocked, statusMessage: STATUS_MESSAGES[blocked] });
      continue;
    }
    const verdict = await facts.isEligible({ guestId: principal.guestId, householdId: principal.householdId, entitlement: e, now });
    if (!verdict.eligible) {
      out.push({ ...base, status: 'ineligible', statusMessage: verdict.reason ? ELIGIBILITY_MESSAGES[verdict.reason] : STATUS_MESSAGES.ineligible });
      continue;
    }
    if (!claim) {
      out.push(base);
      continue;
    }
    const status: BenefitStatus = claim.status === 'issued' ? 'claimed' : claim.status === 'pending' ? 'pending' : claim.status === 'failed' ? 'failed' : 'revoked';
    const view: BenefitView = {
      ...base,
      status,
      statusMessage: STATUS_MESSAGES[status],
      claim: { claimId: claim.id, claimedAt: claim.claimedAt?.toISOString() ?? null, provider: claim.providerName, providerDisplayName: providerDisplayName(claim.providerName, 'uber.com'), testMode: isTestProvider(claim.providerName) },
    };
    const redemption = status === 'claimed' ? redemptionFor(claim, vault, surface) : undefined;
    out.push(redemption ? { ...view, redemption } : view);
  }
  return out;
}

export interface ClaimDeps {
  db: Db;
  audit: AuditSink;
  vault: Vault;
  provider: TransportBenefitProvider;
  principal: Principal;
  entitlementId: string;
  requestId: string;
  now: Date;
  surface: keyof CapabilityExposure;
}

/**
 * The transaction behind `claim_my_transportation_benefit`. The pipeline has already checked
 * auth, entitlement, step-up, confirmation and idempotency; this enforces ownership (the
 * individual guest, never a household manager), eligibility, the one-claim-per-entitlement
 * invariant (unique index), calls the provider idempotently, seals the secret, and audits
 * without ever putting the code or link in audit metadata or logs.
 */
export async function claimBenefit(d: ClaimDeps): Promise<Result<ClaimOutcome, CapabilityError>> {
  if (d.principal.kind !== 'guest') return err(new CapabilityError('forbidden', 'Ride benefits are claimed by the guest they belong to.'));
  const principal = d.principal;
  const actor = toPrincipalRef(principal);
  const entitlement = await getEntitlement(d.db, d.entitlementId);
  if (!entitlement) return err(new CapabilityError('not_found', 'We could not find that ride benefit.'));
  if (entitlement.guestId !== principal.guestId) {
    await d.audit.record({ actor, action: 'transport.claim_failed', target: { type: 'transportation_entitlement', id: entitlement.id }, outcome: 'denied', requestId: d.requestId, metadata: { reason: 'not_owner' } });
    return err(new CapabilityError('forbidden', 'This benefit belongs to another guest.'));
  }
  const blocked = windowStatus(entitlement, d.now);
  if (blocked) return err(new CapabilityError('conflict', STATUS_MESSAGES[blocked], { status: blocked }));
  const verdict = await getTransportEligibilityFactSource().isEligible({ guestId: principal.guestId as GuestId, householdId: principal.householdId as HouseholdId, entitlement, now: d.now });
  if (!verdict.eligible) {
    await d.audit.record({ actor, action: 'transport.claim_failed', target: { type: 'transportation_entitlement', id: entitlement.id }, outcome: 'denied', requestId: d.requestId, metadata: { reason: verdict.reason ?? 'ineligible' } });
    return err(new CapabilityError('forbidden', verdict.reason ? ELIGIBILITY_MESSAGES[verdict.reason] : STATUS_MESSAGES.ineligible, { reason: verdict.reason }));
  }

  // One claim per entitlement: the unique index arbitrates concurrent attempts; the loser reads the winner.
  let claim = await insertPendingClaim(d.db, { entitlementId: entitlement.id, guestId: entitlement.guestId, householdId: entitlement.householdId, providerName: d.provider.name, requestId: d.requestId }, d.now);
  if (!claim) {
    const existing = await getClaimForEntitlement(d.db, entitlement.id);
    if (!existing) return err(new CapabilityError('conflict', 'That claim is still being processed. Please wait a moment.'));
    if (existing.guestId !== principal.guestId) return err(new CapabilityError('forbidden', 'This benefit belongs to another guest.'));
    if (existing.status === 'issued') return outcomeFor(existing, d);
    if (existing.status === 'pending') return err(new CapabilityError('conflict', 'That claim is still being processed. Please wait a moment.'));
    if (existing.status === 'revoked') return err(new CapabilityError('conflict', STATUS_MESSAGES.revoked));
    // failed: retry against the provider with the same claim id (providers are idempotent per claim id)
    await markClaimPending(d.db, existing.id, d.provider.name, d.requestId, d.now);
    claim = { ...existing, status: 'pending', providerName: d.provider.name };
  }

  const issued = await d.provider.createVoucherClaim({ claimId: claim.id, guestId: claim.guestId, entitlementId: entitlement.id, program: entitlement.program, providerProgramRef: entitlement.providerProgramRef ?? undefined });
  if (!issued.ok) {
    const error = toCapabilityError(issued.error);
    await markClaimFailed(d.db, claim.id, issued.error.class, d.now);
    await d.audit.record({ actor, action: 'transport.claim_failed', target: { type: 'transportation_claim', id: claim.id }, outcome: 'failed', requestId: d.requestId, metadata: { entitlementId: entitlement.id, provider: d.provider.name, errorClass: issued.error.class } });
    await recordExternalAction(d.db, d.audit, { kind: 'transport_claim', provider: d.provider.name, status: 'failed', actor, target: { type: 'transportation_claim', id: claim.id }, surface: d.surface, requestId: d.requestId, metadata: { entitlementId: entitlement.id, errorClass: issued.error.class } });
    return err(error);
  }
  const v = issued.value;
  const link = v.redemptionLink;
  const code = v.code;
  if (link && !toGuestHandoff({ provider: d.provider.name, label: 'Open in Uber', url: link, opensNewTab: true, disclosure: '' }).ok) {
    await markClaimFailed(d.db, claim.id, 'redemption link rejected by allowlist', d.now);
    await d.audit.record({ actor, action: 'transport.claim_failed', target: { type: 'transportation_claim', id: claim.id }, outcome: 'failed', requestId: d.requestId, metadata: { entitlementId: entitlement.id, provider: d.provider.name, errorClass: 'redirect_not_allowed' } });
    return err(new CapabilityError('provider_error', 'The ride provider returned a link we cannot open safely. Please ask us for help.'));
  }
  const secret = link ?? code;
  if (!secret) {
    await markClaimFailed(d.db, claim.id, 'no redemption secret', d.now);
    return err(new CapabilityError('provider_error', 'The ride provider did not return a usable credit. Please ask us for help.'));
  }
  const updated = await markClaimIssued(
    d.db,
    claim.id,
    { providerName: d.provider.name, providerRef: v.providerRef ?? null, redemptionKind: link ? 'link' : 'code', secretCiphertext: d.vault.seal(secret), secretKeyId: d.vault.keyId, expiresAt: v.expiresAt ? new Date(v.expiresAt) : null },
    d.now,
  );
  if (!updated) return err(new CapabilityError('internal', 'Something went wrong on our side. Please try again in a moment.'));
  await d.audit.record({
    actor,
    action: 'transport.claimed',
    target: { type: 'transportation_claim', id: claim.id },
    outcome: 'success',
    requestId: d.requestId,
    metadata: { entitlementId: entitlement.id, provider: d.provider.name, issuedAs: updated.redemptionKind, providerRef: v.providerRef },
  });
  await recordExternalAction(d.db, d.audit, {
    kind: 'transport_claim',
    provider: d.provider.name,
    status: 'committed',
    actor,
    target: { type: 'transportation_claim', id: claim.id },
    url: link,
    surface: d.surface,
    requestId: d.requestId,
    metadata: { entitlementId: entitlement.id, issuedAs: updated.redemptionKind },
  });
  return outcomeFor(updated, d);
}

function outcomeFor(claim: TransportationClaimRow, d: Pick<ClaimDeps, 'vault'>): Result<ClaimOutcome, CapabilityError> {
  const redemption = redemptionFor(claim, d.vault, 'ui');
  if (!redemption || redemption.kind === 'hidden') return err(new CapabilityError('internal', 'Something went wrong on our side. Please try again in a moment.'));
  const host = redemption.kind === 'link' ? redemption.host : 'uber.com';
  return ok({
    claimId: claim.id,
    entitlementId: claim.entitlementId,
    status: 'issued',
    provider: claim.providerName,
    providerDisplayName: providerDisplayName(claim.providerName, host),
    testMode: isTestProvider(claim.providerName),
    claimedAt: (claim.claimedAt ?? claim.updatedAt).toISOString(),
    ...(claim.expiresAt ? { expiresAt: claim.expiresAt.toISOString() } : {}),
    redemption,
  });
}

export interface TopicView extends Omit<TransportationTopic, 'directionsTo' | 'officialUrl' | 'officialLabel'> {
  directions?: { google: GuestHandoff; apple: GuestHandoff };
  official?: GuestHandoff;
}

/** Static guidance with map handoffs built from the maps provider (deep links only, allowlisted). */
export function transportationTopics(maps: MapsProvider): TopicView[] {
  return TRANSPORTATION_TOPICS.map((t) => {
    const { directionsTo, officialUrl, officialLabel, ...rest } = t;
    const view: TopicView = { ...rest };
    if (directionsTo) {
      const place = directionsTo === 'valet' ? VALET_ENTRANCE : VENUE_PLACE;
      const google = toGuestHandoff({ provider: 'google', label: `Directions in Google Maps`, url: maps.directionsUrl(place, { mode: directionsTo === 'valet' ? 'driving' : 'transit', platform: 'google' }), opensNewTab: true, disclosure: 'Opens Google Maps.' });
      const apple = toGuestHandoff({ provider: 'apple', label: `Directions in Apple Maps`, url: maps.directionsUrl(place, { mode: directionsTo === 'valet' ? 'driving' : 'transit', platform: 'apple' }), opensNewTab: true, disclosure: 'Opens Apple Maps.' });
      if (google.ok && apple.ok) view.directions = { google: google.value, apple: apple.value };
    }
    if (officialUrl) {
      const official = toGuestHandoff({ provider: 'chicagoathletichotel', label: officialLabel ?? 'Official page', url: officialUrl, opensNewTab: true, disclosure: 'Opens the hotel’s official website.' });
      if (official.ok) view.official = official.value;
    }
    return view;
  });
}

export { hostOf };
