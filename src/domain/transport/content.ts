import type { ContentSourceId } from '@/contracts/ids';
import type { Citation } from '@/contracts/provenance';
import { seedId } from '@/db/seed/sources';

/**
 * Non-transactional transportation guidance. Facts come only from docs/design/brief.md §2
 * (venue address; valet entrance 71 E Madison, accessibility and transit directions on the
 * hotel FAQ; special event valet rate is a kit item to verify). Anything the couple have not
 * decided is a TODO(Tyler & Sara), never a plausible guess (backlog X-02, X-06, P-05).
 */
export const BRIEF_SOURCE = seedId<ContentSourceId>(101);
export const CAA_OFFICIAL_SOURCE = seedId<ContentSourceId>(103);
export const CAA_KIT_SOURCE = seedId<ContentSourceId>(102);
export const BRIEF_VERIFIED_AT = '2026-09-04T00:00:00.000Z';

export const VENUE_PLACE = { name: 'Chicago Athletic Association Hotel', address: '12 S Michigan Ave, Chicago, IL 60603' } as const;
export const VALET_ENTRANCE = { name: 'Chicago Athletic Association valet entrance', address: '71 E Madison St, Chicago, IL 60602' } as const;
export const CAA_FAQ_URL = 'https://www.chicagoathletichotel.com/about/faq/';

export interface TransportationTopic {
  id: string;
  /** Section heading, guest vocabulary. */
  title: string;
  /** Short paragraphs. Placeholder paragraphs start with "TODO(Tyler & Sara)". */
  paragraphs: string[];
  /** Directions handoff targets to render with the maps provider (built by the service, not here). */
  directionsTo?: 'venue' | 'valet';
  /** Official page to link (must be on the redirect allowlist). */
  officialUrl?: string;
  officialLabel?: string;
  sourceId: ContentSourceId;
  verifiedAt: string;
  placeholder: boolean;
}

export const TRANSPORTATION_TOPICS: readonly TransportationTopic[] = [
  {
    id: 'arriving',
    title: 'Arriving in Chicago',
    paragraphs: [
      'Chicago has two airports, O’Hare (ORD) and Midway (MDW). Both connect to downtown by train, taxi and rideshare.',
      'TODO(Tyler & Sara): which airport we recommend, and whether there will be a shuttle.',
    ],
    directionsTo: 'venue',
    sourceId: BRIEF_SOURCE,
    verifiedAt: BRIEF_VERIFIED_AT,
    placeholder: true,
  },
  {
    id: 'do-i-need-a-car',
    title: 'Do I need a car?',
    paragraphs: [
      'The hotel is on Michigan Avenue across from Millennium Park; the wedding happens inside the building, so a car is not needed for the day itself.',
      'If you drive in, the hotel’s valet entrance is at 71 E Madison. TODO(Tyler & Sara): the special event valet rate from the venue kit, once verified.',
    ],
    directionsTo: 'valet',
    sourceId: CAA_OFFICIAL_SOURCE,
    verifiedAt: BRIEF_VERIFIED_AT,
    placeholder: true,
  },
  {
    id: 'getting-around',
    title: 'Getting around: trains, buses, taxis',
    paragraphs: [
      'The CTA runs Chicago’s trains and buses. Taxis and rideshares drop off at the valet entrance on Madison.',
      'The hotel publishes transit and accessibility directions on its FAQ page, including step-free routes into the building.',
    ],
    officialUrl: CAA_FAQ_URL,
    officialLabel: 'Transit and accessibility directions (hotel FAQ)',
    sourceId: CAA_OFFICIAL_SOURCE,
    verifiedAt: BRIEF_VERIFIED_AT,
    placeholder: false,
  },
  {
    id: 'getting-home',
    title: 'Getting home after the reception',
    paragraphs: [
      'We want everyone home safely and without fuss. Eligible adult guests will find a ride benefit on this page once it is ready; the code or link is personal to you.',
      'TODO(Tyler & Sara): ride benefit amount, area and validity (planner item P-05).',
    ],
    sourceId: BRIEF_SOURCE,
    verifiedAt: BRIEF_VERIFIED_AT,
    placeholder: true,
  },
];

export const TRANSPORTATION_CITATIONS: Citation[] = [
  { sourceId: BRIEF_SOURCE, title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: BRIEF_VERIFIED_AT },
  { sourceId: CAA_OFFICIAL_SOURCE, title: 'chicagoathletichotel.com', url: 'https://www.chicagoathletichotel.com/', verifiedAt: BRIEF_VERIFIED_AT },
];
