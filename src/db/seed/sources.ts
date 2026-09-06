import type { ContentSourceId } from '@/contracts/ids';
import type { SourceType, TrustClass } from '@/contracts/provenance';

/**
 * Stable ids for seeded rows so the seed is idempotent. Crockford base32, 26 chars,
 * prefixed "01SEED" so they are recognisable in audit rows.
 */
export const seedId = <T extends string>(n: number): T => `01SEED${String(n).padStart(20, '0')}` as T;

export const SEED_SITE_ID = seedId(1);

export interface SeedSource {
  id: ContentSourceId;
  sourceType: SourceType;
  title: string;
  canonicalUrl?: string;
  documentName?: string;
  verifiedAt: string;
  validFrom?: string;
  validUntil?: string;
  trustClass: TrustClass;
  notes?: string;
}

const BRIEF_DATE = '2026-09-04T00:00:00.000Z';

/** The provenance registry for docs/design/brief.md. Never invent facts; these are the sources of the known ones. */
export const SEED_SOURCES: readonly SeedSource[] = [
  {
    id: seedId<ContentSourceId>(101),
    sourceType: 'authored',
    title: "Tyler's brief 2026-09-04",
    // Citations link guests to a public route, never to a repository path.
    canonicalUrl: '/the-wedding',
    documentName: 'docs/design/brief.md',
    verifiedAt: BRIEF_DATE,
    trustClass: 'TRUSTED_WEDDING',
    notes: 'Consolidated content and design brief. Source of couple, date, venue, story facts.',
  },
  {
    id: seedId<ContentSourceId>(102),
    sourceType: 'venue-document',
    title: 'CAA Wedding Kit 2027',
    documentName: 'CAA Wedding Kit 2027 (2025/26 edition)',
    verifiedAt: BRIEF_DATE,
    validUntil: '2026-12-31T23:59:59.000Z',
    trustClass: 'EXTERNAL_DATA',
    notes: 'Kit figures (capacities, package items) must be verified. Already stale for outlets: Milk Room closed Feb 2025, Cherry Circle Room closed Apr 2024.',
  },
  {
    id: seedId<ContentSourceId>(103),
    sourceType: 'official-web',
    title: 'chicagoathletichotel.com',
    canonicalUrl: 'https://www.chicagoathletichotel.com/',
    verifiedAt: BRIEF_DATE,
    trustClass: 'EXTERNAL_DATA',
    notes: 'Official venue site: outlets, amenities, FAQ (valet, accessibility, transit). Operational facts link here; imagery is copyrighted and never reused.',
  },
  {
    id: seedId<ContentSourceId>(104),
    sourceType: 'contract',
    title: 'Bustle & Lace agreement',
    documentName: 'Bustle & Lace planner agreement',
    verifiedAt: BRIEF_DATE,
    trustClass: 'TRUSTED_WEDDING',
    notes: 'Planner scope and anticipated guest count (110-160). Planner-created design materials are planner IP: never ingest.',
  },
  {
    id: seedId<ContentSourceId>(105),
    sourceType: 'contract',
    title: 'Brooke Alaina Photography contract',
    documentName: 'Brooke Alaina Photography contract',
    verifiedAt: BRIEF_DATE,
    trustClass: 'TRUSTED_WEDDING',
    notes: 'Two photographers; photojournalistic; photographer retains copyright; personal non-commercial online display rights. Third-party AI/biometric processing needs written confirmation.',
  },
  {
    id: seedId<ContentSourceId>(106),
    sourceType: 'contract',
    title: 'Oakhouse Visuals video contract',
    documentName: 'Oakhouse Visuals video contract',
    verifiedAt: BRIEF_DATE,
    trustClass: 'TRUSTED_WEDDING',
    notes: 'Up to 10 h, one videographer; edited ceremony, first dances, toasts; raw footage delivered.',
  },
  {
    id: seedId<ContentSourceId>(107),
    sourceType: 'contract',
    title: 'Rare Bird Beauties HMUA contract',
    documentName: 'Rare Bird Beauties contract',
    verifiedAt: BRIEF_DATE,
    trustClass: 'TRUSTED_WEDDING',
    notes: 'Hair and makeup services and previews.',
  },
  {
    id: seedId<ContentSourceId>(108),
    sourceType: 'official-web',
    title: 'Illinois DNR: Starved Rock State Park',
    canonicalUrl: 'https://dnr.illinois.gov/parks/park.starvedrock.html',
    verifiedAt: '2026-09-05T13:30:00.000Z',
    trustClass: 'EXTERNAL_DATA',
    notes: 'Official state page for the park where the couple first said "I love you" (trail, date, wording unknown). Link-checked 2026-09-05 (HTTP 200).',
  },
];

export const BRIEF_SOURCE_ID = SEED_SOURCES[0]!.id;
