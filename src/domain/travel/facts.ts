import type { ContentSourceId } from '@/contracts/ids';
import type { Citation } from '@/contracts/provenance';
import type { RoomBlock } from '@/db/schema/travel';
import { seedId } from '@/db/seed/sources';
import { CAA_BOOKING_URL, CAA_GROUP_CODE, CAA_BLOCK_CHECK_IN, CAA_BLOCK_CHECK_OUT, caaPhoneBookingSentence } from './stay-copy';

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
  address: '12 S. Michigan Avenue, Chicago, IL 60603',
  url: 'https://www.chicagoathletichotel.com/',
  /** Accessibility and transit directions live on the official FAQ (operational: link, never copy). */
  faqUrl: 'https://www.chicagoathletichotel.com/about/faq/',
  valetEntrance: '71 E. Madison St',
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
  valetNote:
    'Hotel valet 24 hours at 71 E. Madison St, $84 per vehicle, per night, with unlimited in-and-out privileges.',
  /** Backlog X-06 resolved 2026-10-31 (Sara feedback). */
  valetPending: null,
} as const;

/** `note` is a confirmed fact; `pending` names what the couple has still to decide. */
export const AIRPORTS = [
  {
    code: 'ORD',
    name: "O'Hare International Airport",
    note: 'We recommend flying into O’Hare. There is no wedding shuttle; take the CTA Blue Line “L” train into downtown. Rideshare pickup details are coming soon; Uber can take you from the airport to the hotel.',
    pending: null,
  },
  {
    code: 'MDW',
    name: 'Chicago Midway International Airport',
    note: 'Midway also serves Chicago with trains, taxis, and rideshare into downtown.',
    pending: null,
  },
] as const;

/** Brief fallback when no admin hotel row exists yet; matches the seeded production block. */
export const DEFAULT_VENUE_BLOCK: RoomBlock = {
  url: CAA_BOOKING_URL,
  code: CAA_GROUP_CODE,
  rateText: '$331–371 per night',
  checkIn: CAA_BLOCK_CHECK_IN,
  checkOut: CAA_BLOCK_CHECK_OUT,
  cutoff: '2027-06-15',
  note: caaPhoneBookingSentence(),
  pending: null,
  placeholder: false,
};

export const BRIEF_CITATION: Citation = { sourceId: BRIEF_SOURCE_ID, title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_KIT_CITATION: Citation = { sourceId: CAA_KIT_SOURCE_ID, title: 'CAA Wedding Kit 2027', verifiedAt: BRIEF_VERIFIED_AT };
export const CAA_SITE_CITATION: Citation = { sourceId: CAA_SITE_SOURCE_ID, title: 'chicagoathletichotel.com', url: VENUE.url, verifiedAt: BRIEF_VERIFIED_AT };
