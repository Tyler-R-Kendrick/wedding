import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { BRIEF_SOURCE_ID, SEED_SITE_ID } from './sources';

/*
 * On its own, away from seed.ts, because the pages read it too (the lifecycle's fallback when the
 * database has no site row yet). Imported from seed.ts it brought every page's seeded content into
 * every server start, and made `npm run db:seed` import itself in a circle that never settled.
 */

/** Facts from docs/design/brief.md section 2. Anything else is a TODO(Tyler & Sara), never invented. */
export const SEED_SITE = {
  id: SEED_SITE_ID,
  coupleDisplayName: 'Sara + Tyler',
  partner1Name: 'Sara Fitzgerald',
  partner2Name: 'Tyler Kendrick',
  weddingDate: WEDDING_DATE_ISO,
  timezone: WEDDING_TIMEZONE,
  venueName: 'Chicago Athletic Association Hotel',
  venueAddress: '12 S Michigan Ave, Chicago, IL 60603',
  venueUrl: 'https://www.chicagoathletichotel.com/',
  themes: ['botanical-deco'],
  defaultTheme: 'botanical-deco',
  sourceId: BRIEF_SOURCE_ID,
} as const;
