import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { hotelRecommendations } from '../schema/travel';
import { seedId } from './sources';
import { bookingComUrl, hyattSearchUrl } from '@/providers/hotels/deep-link';
import { CAA_KIT_SOURCE_ID, CAA_BOOKING_URL, CAA_GROUP_CODE, CAA_BLOCK_CHECK_IN, CAA_BLOCK_CHECK_OUT, VENUE, VENUE_HOTEL_ID, caaPhoneBookingSentence } from '@/domain/travel';

const SEED_VERIFIED = '2026-11-01T00:00:00.000Z';
const actor = { kind: 'system', component: 'seed' } as const;

/** The room block's nights, so every booking link opens on the wedding weekend. */
const WEEKEND = { checkIn: CAA_BLOCK_CHECK_IN, checkOut: CAA_BLOCK_CHECK_OUT, adults: 2, rooms: 1 } as const;

/**
 * Hotels near the venue that the planner suggested, under the names the couple gave them. Each has
 * its own website (the brand's page for that property, found by its property code) and a booking
 * link that opens on the room block's nights: Hyatt's own booking for the Hyatt, and a Booking.com
 * search for that exact hotel for the others (Marriott's and Hilton's sites take no dates in a
 * link we could rely on). Nothing else is said: no rate, distance or reason. An admin edits any of
 * it in /admin/travel, and from then on this seed leaves the row alone (`contentVersion = 1`).
 *
 * "Residence Inn by Marriott" is the Chicago Downtown/Loop one, the closest to the venue.
 */
export const PLANNER_SUGGESTED_HOTELS = [
  {
    id: seedId(802),
    name: 'Renaissance Hotel Chicago',
    address: '1 W Wacker Dr, Chicago, IL 60601',
    websiteUrl: 'https://www.marriott.com/en-us/hotels/chisr-renaissance-chicago-downtown-hotel/overview/',
    bookingUrl: bookingComUrl({ ...WEEKEND, area: 'Renaissance Chicago Downtown Hotel, Chicago' }),
  },
  {
    id: seedId(803),
    name: 'The Hampton Inn (Majestic Chicago Theatre)',
    address: '22 W Monroe St, Chicago, IL 60603',
    websiteUrl: 'https://www.hilton.com/en/hotels/chitdhx-hampton-majestic-chicago-theatre-district/',
    bookingUrl: bookingComUrl({ ...WEEKEND, area: 'Hampton Inn Majestic Chicago Theatre District, Chicago' }),
  },
  {
    id: seedId(804),
    name: 'Residence Inn by Marriott',
    address: '11 S LaSalle St, Chicago, IL 60603',
    websiteUrl: 'https://www.marriott.com/en-us/hotels/chirl-residence-inn-chicago-downtown-loop/overview/',
    bookingUrl: bookingComUrl({ ...WEEKEND, area: 'Residence Inn by Marriott Chicago Downtown/Loop, Chicago' }),
  },
  {
    id: seedId(805),
    name: 'Hyatt Centric - The Loop',
    address: '100 W Monroe St, Chicago, IL 60603',
    websiteUrl: 'https://www.hyatt.com/en-US/hotel/illinois/hyatt-centric-the-loop-chicago/chihl',
    bookingUrl: hyattSearchUrl(WEEKEND, { propertyCode: 'chihl' }),
  },
] as const;

/**
 * Venue hotel row with the wedding room block (guest-only via list_hotel_recommendations).
 * Idempotent: overwrites only while contentVersion is still 1.
 */
export async function seedTravelHotels(db: Db, now: Date): Promise<void> {
  const values = {
    id: VENUE_HOTEL_ID,
    name: VENUE.name,
    address: VENUE.address,
    isVenue: true,
    sortOrder: 0,
    reasons: [{ kind: 'walk_minutes' as const, text: 'The wedding is here: no travel on the day.', value: 0 }],
    priceBand: null,
    walkMinutesToVenue: 0,
    websiteUrl: VENUE.url,
    bookingUrl: null,
    block: {
      url: CAA_BOOKING_URL,
      code: CAA_GROUP_CODE,
      rateText: '$331–371 per night',
      checkIn: CAA_BLOCK_CHECK_IN,
      checkOut: CAA_BLOCK_CHECK_OUT,
      cutoff: '2027-06-15',
      note: caaPhoneBookingSentence(),
      pending: null,
      placeholder: false,
    },
    placeholder: false,
    active: true,
    sourceId: CAA_KIT_SOURCE_ID,
    verifiedAt: new Date(SEED_VERIFIED),
    contentVersion: 1,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
  };
  await db
    .insert(hotelRecommendations)
    .values(values)
    .onConflictDoUpdate({
      target: hotelRecommendations.id,
      set: {
        name: values.name,
        address: values.address,
        isVenue: values.isVenue,
        sortOrder: values.sortOrder,
        reasons: values.reasons,
        walkMinutesToVenue: values.walkMinutesToVenue,
        websiteUrl: values.websiteUrl,
        bookingUrl: values.bookingUrl,
        block: values.block,
        placeholder: values.placeholder,
        active: values.active,
        sourceId: values.sourceId,
        verifiedAt: values.verifiedAt,
        updatedBy: values.updatedBy,
        updatedAt: values.updatedAt,
      },
      setWhere: sql`${hotelRecommendations.contentVersion} = 1`,
    });

  for (const [i, h] of PLANNER_SUGGESTED_HOTELS.entries()) {
    const row = {
      id: h.id,
      name: h.name,
      address: h.address,
      isVenue: false,
      sortOrder: 10 + i * 10,
      reasons: [] as { kind: 'other'; text: string }[],
      priceBand: null,
      walkMinutesToVenue: null,
      websiteUrl: h.websiteUrl,
      bookingUrl: h.bookingUrl,
      block: null,
      placeholder: false,
      active: true,
      sourceId: null,
      verifiedAt: new Date(SEED_VERIFIED),
      contentVersion: 1,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insert(hotelRecommendations)
      .values(row)
      .onConflictDoUpdate({
        target: hotelRecommendations.id,
        set: { name: row.name, address: row.address, websiteUrl: row.websiteUrl, bookingUrl: row.bookingUrl, reasons: row.reasons, sortOrder: row.sortOrder, placeholder: row.placeholder, active: row.active, updatedBy: row.updatedBy, updatedAt: row.updatedAt },
        setWhere: sql`${hotelRecommendations.contentVersion} = 1`,
      });
  }
}
