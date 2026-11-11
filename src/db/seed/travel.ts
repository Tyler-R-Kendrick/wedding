import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { hotelRecommendations } from '../schema/travel';
import { seedId } from './sources';
import { CAA_KIT_SOURCE_ID, CAA_BOOKING_URL, CAA_GROUP_CODE, CAA_BLOCK_CHECK_IN, CAA_BLOCK_CHECK_OUT, VENUE, VENUE_HOTEL_ID, caaPhoneBookingSentence } from '@/domain/travel';

const SEED_VERIFIED = '2026-11-01T00:00:00.000Z';
const actor = { kind: 'system', component: 'seed' } as const;

/**
 * Hotels our planner, Michelle, suggested near the venue, by name only. Nothing else is known yet,
 * so nothing else is said: no address, rate, distance or link, and the cards carry just the reason.
 * They are not placeholders (there is nothing pending to show); an admin adds details in
 * /admin/travel, and from then on this seed leaves the row alone (`contentVersion = 1`).
 */
export const PLANNER_SUGGESTED_HOTELS = [
  { id: seedId(802), name: 'Renaissance Hotel Chicago' },
  { id: seedId(803), name: 'The Hampton Inn (Majestic Chicago Theatre)' },
  { id: seedId(804), name: 'Residence Inn by Marriott' },
  { id: seedId(805), name: 'Hyatt Centric - The Loop' },
] as const;
const PLANNER_REASON = 'Suggested by our planner, Michelle.';

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
      address: null,
      isVenue: false,
      sortOrder: 10 + i * 10,
      reasons: [{ kind: 'other' as const, text: PLANNER_REASON }],
      priceBand: null,
      walkMinutesToVenue: null,
      websiteUrl: null,
      bookingUrl: null,
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
        set: { name: row.name, reasons: row.reasons, sortOrder: row.sortOrder, placeholder: row.placeholder, active: row.active, updatedBy: row.updatedBy, updatedAt: row.updatedAt },
        setWhere: sql`${hotelRecommendations.contentVersion} = 1`,
      });
  }
}
