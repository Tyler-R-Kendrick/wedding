import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { hotelRecommendations } from '../schema/travel';
import { CAA_KIT_SOURCE_ID, VENUE, VENUE_HOTEL_ID } from '@/domain/travel';

const SEED_VERIFIED = '2026-10-31T00:00:00.000Z';
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
      url: null,
      code: 'G-FIKE',
      rateText: '$331–371/night',
      checkIn: '2027-07-16',
      checkOut: '2027-07-18',
      cutoff: '2027-06-15',
      note: 'Call 844-312-2221 to book with group code G-FIKE.',
      pending: 'the Hyatt group booking link for this block',
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
