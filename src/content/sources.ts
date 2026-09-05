import type { ContentSourceId } from '@/contracts/ids';
import { seedId } from '@/db/seed/sources';

/**
 * Human-readable keys used inside the seed JSON, resolved to content_sources ids
 * (src/db/seed/sources.ts). Adding a source means adding it there first.
 */
export const SOURCE_KEYS = {
  /** Tyler's brief 2026-09-04 (authored, TRUSTED_WEDDING). */
  brief: seedId<ContentSourceId>(101),
  /** CAA Wedding Kit 2027, 2025/26 edition (venue-document, EXTERNAL_DATA, already stale for outlets). */
  'caa-kit': seedId<ContentSourceId>(102),
  /** chicagoathletichotel.com (official-web, EXTERNAL_DATA). */
  'caa-web': seedId<ContentSourceId>(103),
  /** Illinois DNR page for Starved Rock State Park (official-web, EXTERNAL_DATA). */
  'starved-rock-web': seedId<ContentSourceId>(108),
} as const;

export type SourceKey = keyof typeof SOURCE_KEYS;

/** ISO date the brief was written; authored facts are verified as of then. */
export const BRIEF_VERIFIED_AT = '2026-09-04T00:00:00.000Z';
/** The day the official pages were link-checked while seeding (HTTP 200 on every URL below). */
export const LINK_CHECK_VERIFIED_AT = '2026-09-05T13:30:00.000Z';
/** The kit is a 2025/26 document; treat it as expired after this date unless re-verified. */
export const KIT_VALID_UNTIL = '2026-12-31T23:59:59.000Z';

export const EDITED_BY = {
  brief: 'seed:brief-2026-09-04',
  kit: 'seed:caa-kit-2025-26',
  linkCheck: 'seed:link-check-2026-09-05',
} as const;
