import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { SiteFacts, VenueFacts } from '@/themes/types';
import { dateFacts } from './countdown';

/** Google Maps search deep link for a full address (allow-listed host, prints as a full URL). */
export function mapsUrlFor(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export interface SiteFactsInput {
  coupleDisplayName: string;
  partner1Name: string;
  partner2Name: string;
  weddingDate: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueUrl: string | null;
}

/** Facts come from `site_settings` (seeded from docs/design/brief.md §2). Nothing here is invented. */
export function toSiteFacts(row: SiteFactsInput): SiteFacts {
  const venue: VenueFacts = {
    name: row.venueName,
    address: row.venueAddress,
    city: 'Chicago',
    url: row.venueUrl,
    mapsUrl: mapsUrlFor(row.venueAddress),
    mapsProvider: 'Google Maps',
  };
  return {
    coupleDisplayName: row.coupleDisplayName,
    partner1: row.partner1Name,
    partner2: row.partner2Name,
    date: dateFacts(row.weddingDate || WEDDING_DATE_ISO, row.timezone || WEDDING_TIMEZONE),
    venue,
  };
}
