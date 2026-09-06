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
  /**
   * A confirmed fact and a still-unknown one are two fields, not one string.
   *
   * These carried `TODO(Tyler & Sara): … (backlog X-06)` inline, and the travel page printed the
   * whole thing — so a visitor read the authoring marker and an internal backlog id. The marker is
   * how a record says "not a fact yet"; `pending` below is the signal a renderer reads, and the
   * backlog id lives in this comment where it belongs. The same records are returned by
   * `list_hotel_recommendations`, which is exposed to the concierge and WebMCP, so the marker would
   * have reached assistant transcripts too.
   */
  valetNote: 'A special event valet rate is part of the CAA package.',
  /** Backlog X-06. */
  valetPending: 'the valet rate, and whether we can publish it',
} as const;

/** `note` is a confirmed fact; `pending` names what the couple has still to decide (backlog X-02). */
export const AIRPORTS = [
  { code: 'ORD', name: "O'Hare International Airport", note: null, pending: 'which airport we recommend, and whether there is a shuttle' },
  { code: 'MDW', name: 'Chicago Midway International Airport', note: null, pending: 'which airport we recommend, and whether there is a shuttle' },
] as const;

/** From the CAA kit (2025/26 edition, verify): a courtesy block up to 20 rooms subject to availability. Everything else is unknown. */
export const DEFAULT_VENUE_BLOCK: RoomBlock = {
  url: null,
  code: null,
  rateText: null,
  checkIn: null,
  checkOut: null,
  cutoff: null,
  note: 'The CAA offers a courtesy block of up to 20 rooms, subject to availability (2025/26 kit; to verify).',
  /** Backlog P-03: the planner supplies these. */
  pending: 'the booking link, rate, dates and cutoff',
  placeholder: true,
};

export const BRIEF_CITATION: Citation = { sourceId: BRIEF_SOURCE_ID, title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_KIT_CITATION: Citation = { sourceId: CAA_KIT_SOURCE_ID, title: 'CAA Wedding Kit 2027', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_SITE_CITATION: Citation = { sourceId: CAA_SITE_SOURCE_ID, title: 'chicagoathletichotel.com', url: VENUE.url, verifiedAt: BRIEF_VERIFIED_AT };
