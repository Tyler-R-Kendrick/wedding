import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { hotelRecommendations } from '../schema/travel';
import { CAA_KIT_SOURCE_ID, CAA_BOOKING_URL, CAA_GROUP_CODE, CAA_BLOCK_CHECK_IN, CAA_BLOCK_CHECK_OUT, VENUE, VENUE_HOTEL_ID, caaPhoneBookingSentence } from '@/domain/travel';

const SEED_VERIFIED = '2026-11-01T00:00:00.000Z';
const actor = { kind: 'system', component: 'seed' } as const;

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
}
