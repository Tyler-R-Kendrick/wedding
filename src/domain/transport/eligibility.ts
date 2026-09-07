import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { TransportationEntitlementRow } from '@/db/schema';

/**
 * Who may claim a ride benefit. An entitlement row (admin-assigned) is necessary but not
 * sufficient: the fact source answers the personal question (adult? still in the household?).
 * Default: the admin-entered `guestIsMinor` flag on the entitlement — adults eligible,
 * children never. At integration the identity swarm registers its own source
 * (`registerEntitlementFactSource` in src/domain/identity) here via `setTransportEligibilityFactSource`.
 */
export type EligibilityReason = 'minor' | 'unknown_guest' | 'not_in_household';

export interface EligibilityQuery {
  guestId: GuestId;
  householdId: HouseholdId;
  entitlement: TransportationEntitlementRow;
  now: Date;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason?: EligibilityReason;
}

export interface TransportEligibilityFactSource {
  isEligible(query: EligibilityQuery): Promise<EligibilityVerdict>;
}

export const defaultEligibilityFactSource: TransportEligibilityFactSource = {
  async isEligible({ entitlement }) {
    return entitlement.guestIsMinor ? { eligible: false, reason: 'minor' } : { eligible: true };
  },
};

const g = globalThis as unknown as { __weddingTransportEligibility?: TransportEligibilityFactSource };

export function setTransportEligibilityFactSource(source: TransportEligibilityFactSource | undefined): void {
  if (source) g.__weddingTransportEligibility = source;
  else delete g.__weddingTransportEligibility;
}

export function getTransportEligibilityFactSource(): TransportEligibilityFactSource {
  return g.__weddingTransportEligibility ?? defaultEligibilityFactSource;
}

export const ELIGIBILITY_MESSAGES: Record<EligibilityReason, string> = {
  minor: 'Ride benefits are for adult guests. A parent or guardian in your party can claim theirs.',
  unknown_guest: 'We could not match this benefit to your invitation. Please ask us for help.',
  not_in_household: 'This benefit belongs to another household.',
};
