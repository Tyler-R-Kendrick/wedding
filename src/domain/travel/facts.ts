import type { ContentSourceId } from '@/contracts/ids';
import type { Citation } from '@/contracts/provenance';
import type { RoomBlock } from '@/db/schema/travel';
import { seedId } from '@/db/seed/sources';

/**
 * The only wedding facts this feature may state, all from docs/design/brief.md §2 with their
 * seeded provenance rows. Everything else is a typed placeholder the couple or planner fills in
 * (backlog P-03 room block, P-04 alternative hotels, X-02 airport recommendation, X-06 valet rate).
 */
export const BRIEF_VERIFIED_AT = '2026-09-04T00:00:00.000Z';
export const BRIEF_SOURCE_ID = seedId<ContentSourceId>(101);
export const CAA_KIT_SOURCE_ID = seedId<ContentSourceId>(102);
export const CAA_SITE_SOURCE_ID = seedId<ContentSourceId>(103);

export const VENUE = {
  name: 'Chicago Athletic Association Hotel',
  address: '12 S Michigan Ave, Chicago, IL 60603',
  url: 'https://www.chicagoathletichotel.com/',
  /** Accessibility and transit directions live on the official FAQ (operational: link, never copy). */
  faqUrl: 'https://www.chicagoathletichotel.com/about/faq/',
  valetEntrance: '71 E Madison',
  valetNote: 'A special event valet rate is part of the CAA package. TODO(Tyler & Sara): confirm the rate and whether it may be published (backlog X-06).',
} as const;

export const AIRPORTS = [
  { code: 'ORD', name: "O'Hare International Airport", note: 'TODO(Tyler & Sara): which airport to recommend and any shuttle (backlog X-02).' },
  { code: 'MDW', name: 'Chicago Midway International Airport', note: 'TODO(Tyler & Sara): which airport to recommend and any shuttle (backlog X-02).' },
] as const;

/** From the CAA kit (2025/26 edition, verify): a courtesy block up to 20 rooms subject to availability. Everything else is unknown. */
export const DEFAULT_VENUE_BLOCK: RoomBlock = {
  url: null,
  code: null,
  rateText: null,
  checkIn: null,
  checkOut: null,
  cutoff: null,
  note: 'The CAA offers a courtesy block of up to 20 rooms, subject to availability (2025/26 kit; to verify). TODO(Tyler & Sara): booking link, rate, dates and cutoff from the planner (backlog P-03).',
  placeholder: true,
};

export const BRIEF_CITATION: Citation = { sourceId: BRIEF_SOURCE_ID, title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_KIT_CITATION: Citation = { sourceId: CAA_KIT_SOURCE_ID, title: 'CAA Wedding Kit 2027', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_SITE_CITATION: Citation = { sourceId: CAA_SITE_SOURCE_ID, title: 'chicagoathletichotel.com', url: VENUE.url, verifiedAt: BRIEF_VERIFIED_AT };
