import type { ContentSourceId } from './ids';

/**
 * Every fact the site shows or the AI cites carries provenance. Durable story
 * content and rapidly-changing operational data share this model so stale
 * data is visible to admins and never presented as evergreen truth.
 */
export const SOURCE_TYPES = ['authored', 'contract', 'venue-document', 'official-web', 'provider-api', 'admin', 'guest'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Trust classification for anything entering the AI/agent layer.
 * - TRUSTED_WEDDING: couple/admin-authored and validated structured data.
 * - EXTERNAL_DATA: provider availability, menus, flight/hotel results, official web pages.
 * - UNTRUSTED_USER_CONTENT: guest captions, uploaded metadata, comments, arbitrary strings.
 * External/untrusted content is data, never instructions.
 */
export const TRUST_CLASSES = ['TRUSTED_WEDDING', 'EXTERNAL_DATA', 'UNTRUSTED_USER_CONTENT'] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

export interface Provenance {
  sourceId: ContentSourceId;
  sourceType: SourceType;
  /** Human-readable title for "Based on…" citations. */
  title: string;
  /** Route or URL the citation links to (internal route preferred). */
  canonicalUrl?: string;
  /** e.g. "Wedding Kit 2027.pdf" — never the private file itself. */
  documentName?: string;
  /** ISO timestamp an editor/admin last verified the fact. */
  verifiedAt: string;
  validFrom?: string;
  validUntil?: string;
  trustClass: TrustClass;
  contentVersion: number;
  /** Structured record backing the fact, when applicable (e.g. seat assignment row). */
  recordRef?: { type: string; id: string };
}

export type Freshness = 'fresh' | 'aging' | 'stale' | 'expired' | 'not_yet_valid';

export interface FreshnessPolicy {
  /** Days after verifiedAt before a fact is "aging". */
  agingAfterDays: number;
  /** Days after verifiedAt before a fact is "stale". */
  staleAfterDays: number;
}

/** Durable venue history can live for years; operational facts (hours, menus) must be re-verified often. */
export const FRESHNESS_POLICIES: Record<'durable' | 'operational' | 'live', FreshnessPolicy> = {
  durable: { agingAfterDays: 365, staleAfterDays: 730 },
  operational: { agingAfterDays: 30, staleAfterDays: 90 },
  live: { agingAfterDays: 0, staleAfterDays: 1 },
};

export function freshnessOf(p: Pick<Provenance, 'verifiedAt' | 'validFrom' | 'validUntil'>, policy: FreshnessPolicy, now: Date = new Date()): Freshness {
  const t = now.getTime();
  if (p.validFrom && t < Date.parse(p.validFrom)) return 'not_yet_valid';
  if (p.validUntil && t > Date.parse(p.validUntil)) return 'expired';
  const ageDays = (t - Date.parse(p.verifiedAt)) / 86_400_000;
  if (ageDays > policy.staleAfterDays) return 'stale';
  if (ageDays > policy.agingAfterDays) return 'aging';
  return 'fresh';
}

/** A citation is the guest-visible projection of provenance. */
export interface Citation {
  sourceId: ContentSourceId;
  title: string;
  url?: string;
  verifiedAt?: string;
  recordRef?: { type: string; id: string };
}

export function toCitation(p: Provenance): Citation {
  return { sourceId: p.sourceId, title: p.title, url: p.canonicalUrl, verifiedAt: p.verifiedAt, recordRef: p.recordRef };
}
