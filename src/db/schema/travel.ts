import { boolean, date, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
// Level 06 owns these. Swarm F built before they existed, so its guest and household columns were
// plain text; they are real foreign keys as of this integration rather than debt deferred to 15.
import { guests, households } from './guests';

/**
 * Travel & Stay (level 08). Guest-owned rows carry `guest_id` + `household_id` so every
 * handler can re-check ownership against the principal; nothing here is ever read without
 * that check. Curated rows (hotels, links) carry provenance (`source_id`, `verified_at`,
 * `content_version`, `updated_by`) per ADR-0011 and a `placeholder` flag for facts the
 * couple has not supplied yet (`TODO(Tyler & Sara)`), never plausible fiction.
 */

export const CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first'] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const ITINERARY_KINDS = ['flight', 'hotel', 'other'] as const;
export type ItineraryKind = (typeof ITINERARY_KINDS)[number];

export const ITINERARY_STATUSES = ['planned', 'confirmed', 'cancelled'] as const;
export type ItineraryStatus = (typeof ITINERARY_STATUSES)[number];

/** How a booking became "confirmed": the guest said so on the website, or a trusted provider webhook did. Never a link click. */
export const CONFIRMATION_SOURCES = ['guest', 'webhook'] as const;
export type ConfirmationSource = (typeof CONFIRMATION_SOURCES)[number];

export const HOTEL_REASON_KINDS = ['walk_minutes', 'staffed_desk', 'family_suites', 'price_band', 'accessible_route', 'transit', 'other'] as const;
export type HotelReasonKind = (typeof HOTEL_REASON_KINDS)[number];

export const PRICE_BANDS = ['$', '$$', '$$$', '$$$$'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export const TRAVEL_LINK_CATEGORIES = ['airline', 'ota', 'hotel', 'transit', 'other'] as const;
export type TravelLinkCategory = (typeof TRAVEL_LINK_CATEGORIES)[number];

/** One objective reason the couple recommends a hotel (never a safety claim). */
export interface HotelReason {
  kind: HotelReasonKind;
  /** Short guest-facing text, e.g. "6 minute walk to the CAA". */
  text: string;
  /** Structured value when the kind has one (minutes, band). */
  value?: number | string;
}

/**
 * The venue's courtesy room block. Every field except the kit note is unknown until the
 * planner supplies it; `placeholder: true` keeps the card honest (brief §2, backlog P-03).
 */
export interface RoomBlock {
  /** Booking URL or code from the planner; must pass the redirect allowlist. */
  url: string | null;
  code: string | null;
  /** Guest-facing rate text, e.g. "$xxx/night + tax" — never guessed. */
  rateText: string | null;
  /** YYYY-MM-DD */
  checkIn: string | null;
  checkOut: string | null;
  /** YYYY-MM-DD: last day to book at the block rate. */
  cutoff: string | null;
  /** From the CAA kit: "courtesy block up to 20 rooms subject to availability". */
  note: string | null;
  placeholder: boolean;
}

/** Structured details for an itinerary item; free text stays short and is never logged. */
export interface ItineraryDetails {
  origin?: string;
  destination?: string;
  carrier?: string;
  flightNumber?: string;
  hotelName?: string;
  address?: string;
  /** Guest-visible note (max 500 chars, validated by the domain schema). */
  note?: string;
}

/** Opt-in, editable, deletable travel preferences. Never inferred from IP. One row per guest. */
export const guestTravelProfiles = pgTable(
  'guest_travel_profiles',
  {
    // Cascade: a travel profile is opt-in personal data about one guest (home city, airport,
    // travel dates), so deleting the guest must delete it. The household column matches what
    // level 07 chose for `guest_needs`, so there is one deletion story, not two.
    guestId: text('guest_id')
      .$type<GuestId>()
      .primaryKey()
      .references(() => guests.id, { onDelete: 'cascade' }),
    householdId: text('household_id')
      .$type<HouseholdId>()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    homeCity: text('home_city'),
    homeRegion: text('home_region'),
    /** IATA code the guest prefers to fly from. */
    preferredAirport: text('preferred_airport'),
    alternateAirports: jsonb('alternate_airports').$type<string[]>().notNull().default([]),
    adults: integer('adults').notNull().default(1),
    children: integer('children').notNull().default(0),
    airlinePreference: text('airline_preference'),
    nonstopPreferred: boolean('nonstop_preferred').notNull().default(false),
    cabin: text('cabin').$type<CabinClass>().notNull().default('economy'),
    arriveEarliest: date('arrive_earliest'),
    arriveLatest: date('arrive_latest'),
    departEarliest: date('depart_earliest'),
    departLatest: date('depart_latest'),
    /** The guest opted in at this time; deleting the row withdraws the opt-in. */
    consentedAt: timestamp('consented_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('guest_travel_profiles_household_idx').on(t.householdId)],
);

/** The trip bridge: what a guest recorded or confirmed (flights, hotel, other). */
export const guestItineraryItems = pgTable(
  'guest_itinerary_items',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id')
      .$type<GuestId>()
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    householdId: text('household_id')
      .$type<HouseholdId>()
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ItineraryKind>().notNull(),
    status: text('status').$type<ItineraryStatus>().notNull().default('planned'),
    title: text('title').notNull(),
    /** Provider the item came from or was booked with (e.g. "skyscanner", "duffel-links", "guest"). */
    provider: text('provider'),
    /** External reference (booking reference / hosted-session reference). Guest-entered or webhook-supplied. */
    providerRef: text('provider_ref'),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
    timezone: text('timezone').notNull().default('America/Chicago'),
    details: jsonb('details').$type<ItineraryDetails>().notNull().default({}),
    confirmedVia: text('confirmed_via').$type<ConfirmationSource>(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    createdBy: jsonb('created_by').$type<PrincipalRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('guest_itinerary_items_guest_idx').on(t.guestId, t.startAt),
    index('guest_itinerary_items_household_idx').on(t.householdId),
    index('guest_itinerary_items_provider_ref_idx').on(t.providerRef),
  ],
);

/** Curated hotels: the venue block first, then alternatives with the couple's objective reasons. */
export const hotelRecommendations = pgTable(
  'hotel_recommendations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    address: text('address'),
    /** True for the venue hotel (CAA); its `block` holds the room-block record. */
    isVenue: boolean('is_venue').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(100),
    reasons: jsonb('reasons').$type<HotelReason[]>().notNull().default([]),
    priceBand: text('price_band').$type<PriceBand>(),
    walkMinutesToVenue: integer('walk_minutes_to_venue'),
    websiteUrl: text('website_url'),
    /** Direct booking link (allowlisted) when the couple has one; otherwise a search deep link is built per request. */
    bookingUrl: text('booking_url'),
    block: jsonb('block').$type<RoomBlock | null>(),
    placeholder: boolean('placeholder').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sourceId: text('source_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
    contentVersion: integer('content_version').notNull().default(1),
    updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('hotel_recommendations_order_idx').on(t.active, t.sortOrder)],
);

/** Admin-configured airline / OTA / transit deep links for the deep-link-only fallback rung. */
export const travelLinks = pgTable(
  'travel_links',
  {
    id: text('id').primaryKey(),
    category: text('category').$type<TravelLinkCategory>().notNull(),
    /** Provider name shown on the handoff ("Continue on United"). */
    provider: text('provider').notNull(),
    label: text('label').notNull(),
    /** Must pass `assertAllowedRedirect` when written and is re-checked when read. */
    url: text('url').notNull(),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(100),
    active: boolean('active').notNull().default(true),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedBy: jsonb('updated_by').$type<PrincipalRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('travel_links_order_idx').on(t.active, t.category, t.sortOrder)],
);

export type GuestTravelProfileRow = typeof guestTravelProfiles.$inferSelect;
export type GuestItineraryItemRow = typeof guestItineraryItems.$inferSelect;
export type HotelRecommendationRow = typeof hotelRecommendations.$inferSelect;
export type TravelLinkRow = typeof travelLinks.$inferSelect;
