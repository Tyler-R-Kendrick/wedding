import { FRESHNESS_POLICIES, freshnessOf, type Freshness, type FreshnessPolicy, type SourceType } from '@/contracts/provenance';

export type FreshnessPolicyName = 'durable' | 'venue-document' | 'operational' | 'live';

/**
 * Freshness budgets per source type (ADR-0011 rule 3): official pages 30 days, venue documents
 * 90 days, provider data per adapter TTL, authored/contract copy effectively none.
 */
export const POLICY_FOR_SOURCE: Record<SourceType, FreshnessPolicyName> = {
  authored: 'durable',
  contract: 'durable',
  admin: 'durable',
  guest: 'durable',
  'venue-document': 'venue-document',
  'official-web': 'operational',
  'provider-api': 'live',
};

export const POLICIES: Record<FreshnessPolicyName, FreshnessPolicy> = {
  durable: FRESHNESS_POLICIES.durable,
  'venue-document': { agingAfterDays: 90, staleAfterDays: 180 },
  operational: FRESHNESS_POLICIES.operational,
  live: FRESHNESS_POLICIES.live,
};

export function policyFor(sourceType: SourceType): FreshnessPolicyName {
  return POLICY_FOR_SOURCE[sourceType];
}

export interface FreshnessInput {
  sourceType: SourceType;
  verifiedAt: Date | string;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
}

const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());

/** Freshness of a record at `now`, using the policy for its source type. */
export function computeFreshness(row: FreshnessInput, now: Date): Freshness {
  return freshnessOf(
    { verifiedAt: iso(row.verifiedAt), validFrom: row.validFrom ? iso(row.validFrom) : undefined, validUntil: row.validUntil ? iso(row.validUntil) : undefined },
    POLICIES[policyFor(row.sourceType)],
    now,
  );
}

/** Whether the UI and the concierge must attach the "last checked … confirm with …" caveat. */
export function needsCaveat(f: Freshness): boolean {
  return f === 'aging' || f === 'stale' || f === 'expired' || f === 'not_yet_valid';
}

/** Guest-facing wording. Dates are formatted by the caller so the recipe controls locale. */
export const FRESHNESS_LABELS: Record<Freshness, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  fresh: { label: 'Checked', tone: 'ok' },
  aging: { label: 'Last checked', tone: 'warn' },
  stale: { label: 'Needs re-checking', tone: 'bad' },
  expired: { label: 'No longer current', tone: 'bad' },
  not_yet_valid: { label: 'Not yet in effect', tone: 'muted' },
};

/** Days since the record was verified (for admin stale-data warnings). */
export function daysSinceVerified(verifiedAt: Date | string, now: Date): number {
  return Math.floor((now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000);
}
