import type { ContentSourceId } from '@/contracts/ids';
import type { Citation, Freshness, SourceType, TrustClass } from '@/contracts/provenance';
import type { ContentSourceRow } from '@/db/schema/content';
import { computeFreshness, policyFor, type FreshnessPolicyName } from './freshness';

/** The row fields provenance helpers need; every content table has them. */
export interface ProvenanceFields {
  sourceId: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  verifiedAt: Date;
  validFrom: Date | null;
  validUntil: Date | null;
  trustClass: TrustClass;
  contentVersion: number;
  editedBy: string;
}

/** Guest-visible provenance projected for the recipes (SourceBadge, FreshnessBadge). */
export interface ProvenanceView {
  sourceId: string;
  sourceType: SourceType;
  /** Human title of the source ("chicagoathletichotel.com", "Tyler's brief"). */
  sourceTitle: string;
  /** Public link for "confirm with …": the official page for external data, otherwise the internal route. */
  url?: string;
  verifiedAt: string;
  validFrom?: string;
  validUntil?: string;
  trustClass: TrustClass;
  contentVersion: number;
  editedBy: string;
  freshness: Freshness;
  policy: FreshnessPolicyName;
  /** EXTERNAL_DATA must always be labelled with its source and date (ADR-0011 rule 1). */
  external: boolean;
}

export type SourceTitles = ReadonlyMap<string, string>;

export function sourceTitleMap(rows: readonly Pick<ContentSourceRow, 'id' | 'title'>[]): SourceTitles {
  return new Map(rows.map((r) => [r.id, r.title]));
}

const FALLBACK_TITLES: Record<SourceType, string> = {
  authored: 'Sara + Tyler',
  contract: 'Vendor contract',
  'venue-document': 'Venue document',
  'official-web': 'Official website',
  'provider-api': 'Live provider data',
  admin: 'Site admin',
  guest: 'Guest contribution',
};

export interface ProvenanceOptions {
  /** Internal route (with anchor) where this record renders; the citation for authored content. */
  route: string;
  sources?: SourceTitles;
  now: Date;
}

/** Public URL for a record: official page for external data, else the internal route. Never a repo path. */
export function publicUrlFor(row: Pick<ProvenanceFields, 'sourceType' | 'sourceUrl'>, route: string): string {
  const external = row.sourceType === 'official-web' || row.sourceType === 'provider-api';
  if (external && row.sourceUrl && /^https:\/\//.test(row.sourceUrl)) return row.sourceUrl;
  return route;
}

export function toProvenanceView(row: ProvenanceFields, opts: ProvenanceOptions): ProvenanceView {
  return {
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceTitle: opts.sources?.get(row.sourceId) ?? FALLBACK_TITLES[row.sourceType],
    url: publicUrlFor(row, opts.route),
    verifiedAt: row.verifiedAt.toISOString(),
    validFrom: row.validFrom?.toISOString(),
    validUntil: row.validUntil?.toISOString(),
    trustClass: row.trustClass,
    contentVersion: row.contentVersion,
    editedBy: row.editedBy,
    freshness: computeFreshness(row, opts.now),
    policy: policyFor(row.sourceType),
    external: row.trustClass === 'EXTERNAL_DATA',
  };
}

/** Citation for the capability envelope: public route or official URL, never a repository path. */
export function toRecordCitation(row: ProvenanceFields, opts: ProvenanceOptions & { title: string; recordRef: { type: string; id: string } }): Citation {
  return {
    sourceId: row.sourceId as ContentSourceId,
    title: opts.title,
    url: publicUrlFor(row, opts.route),
    verifiedAt: row.verifiedAt.toISOString(),
    recordRef: opts.recordRef,
  };
}

/** De-duplicates citations by (sourceId, url, recordRef) so envelopes stay small. */
export function dedupeCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    const key = `${c.sourceId}|${c.url ?? ''}|${c.recordRef?.type ?? ''}:${c.recordRef?.id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
