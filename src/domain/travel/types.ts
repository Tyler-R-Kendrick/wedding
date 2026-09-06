import { z } from 'zod';
import { CABIN_CLASSES, HOTEL_REASON_KINDS, ITINERARY_KINDS, ITINERARY_STATUSES, PRICE_BANDS, TRAVEL_LINK_CATEGORIES } from '@/db/schema/travel';
import { CHICAGO_AIRPORTS, FLIGHT_CABINS } from '@/providers/flights/types';

/**
 * Zod schemas shared by the travel capabilities (input validation) and the domain (output
 * shapes). Everything guest-supplied is bounded; nothing here is a fact about the wedding.
 */

export const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code, for example LAX.');

const isRealDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
};
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').refine(isRealDate, 'That is not a calendar date.');

export const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Unknown id.');

export const externalUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2_048);

/** A date-time as an ISO string with offset, or a local wall time ("YYYY-MM-DDTHH:mm") interpreted in `timezone`. */
export const whenInput = z.string().trim().min(10).max(40);

export const timezoneInput = z
  .string()
  .trim()
  .max(64)
  .default('America/Chicago')
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone.');

// ---------------------------------------------------------------- travel profile

/** Field shape, exported so capabilities can compose it (Zod 4 refinements do not survive `.extend`). */
export const travelProfileFields = {
  homeCity: z.string().trim().min(1).max(80).nullable().optional(),
  homeRegion: z.string().trim().min(1).max(80).nullable().optional(),
  preferredAirport: iata.nullable().optional(),
  alternateAirports: z.array(iata).max(4).default([]),
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  airlinePreference: z.string().trim().min(1).max(60).nullable().optional(),
  nonstopPreferred: z.boolean().default(false),
  cabin: z.enum(CABIN_CLASSES).default('economy'),
  arriveEarliest: isoDate.nullable().optional(),
  arriveLatest: isoDate.nullable().optional(),
  departEarliest: isoDate.nullable().optional(),
  departLatest: isoDate.nullable().optional(),
};

type ProfileWindows = { arriveEarliest?: string | null; arriveLatest?: string | null; departEarliest?: string | null; departLatest?: string | null };
export const refineProfileWindows = (v: ProfileWindows, ctx: z.RefinementCtx): void => {
  if (v.arriveEarliest && v.arriveLatest && v.arriveLatest < v.arriveEarliest) ctx.addIssue({ code: 'custom', path: ['arriveLatest'], message: 'Latest arrival must be on or after the earliest.' });
  if (v.departEarliest && v.departLatest && v.departLatest < v.departEarliest) ctx.addIssue({ code: 'custom', path: ['departLatest'], message: 'Latest departure must be on or after the earliest.' });
  if (v.arriveLatest && v.departEarliest && v.departEarliest < v.arriveLatest) ctx.addIssue({ code: 'custom', path: ['departEarliest'], message: 'Departure cannot be before arrival.' });
};

export const travelProfileInput = z.object(travelProfileFields).superRefine(refineProfileWindows);
export type TravelProfileInput = z.infer<typeof travelProfileInput>;

export const travelProfileOutput = z.object({
  guestId: z.string(),
  homeCity: z.string().nullable(),
  homeRegion: z.string().nullable(),
  preferredAirport: z.string().nullable(),
  alternateAirports: z.array(z.string()),
  adults: z.number().int(),
  children: z.number().int(),
  airlinePreference: z.string().nullable(),
  nonstopPreferred: z.boolean(),
  cabin: z.enum(CABIN_CLASSES),
  arriveEarliest: z.string().nullable(),
  arriveLatest: z.string().nullable(),
  departEarliest: z.string().nullable(),
  departLatest: z.string().nullable(),
  consentedAt: z.string(),
  updatedAt: z.string(),
});
export type TravelProfile = z.infer<typeof travelProfileOutput>;

/** A suggestion the guest must confirm (never applied silently, never from IP). */
export const locationSuggestion = z.object({
  source: z.literal('invitation'),
  city: z.string().optional(),
  region: z.string().optional(),
  airport: z.string().optional(),
});
export type LocationSuggestion = z.infer<typeof locationSuggestion>;

// ---------------------------------------------------------------- search

export const flightSearchFields = {
  origin: iata,
  destination: z.enum(CHICAGO_AIRPORTS).default('ORD'),
  departDate: isoDate,
  returnDate: isoDate.optional(),
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  cabin: z.enum(FLIGHT_CABINS).default('economy'),
  nonstopOnly: z.boolean().default(false),
};
export const refineFlightSearch = (v: { origin: string; departDate: string; returnDate?: string }, ctx: z.RefinementCtx): void => {
  if (v.returnDate && v.returnDate < v.departDate) ctx.addIssue({ code: 'custom', path: ['returnDate'], message: 'Return must be on or after departure.' });
  if ((CHICAGO_AIRPORTS as readonly string[]).includes(v.origin)) ctx.addIssue({ code: 'custom', path: ['origin'], message: 'Choose the airport you are flying from, not Chicago.' });
};
export const flightSearchInput = z.object({ kind: z.literal('flights'), ...flightSearchFields }).superRefine(refineFlightSearch);
export type FlightSearchInput = z.infer<typeof flightSearchInput>;

export const hotelSearchFields = {
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int().min(1).max(9).default(2),
  children: z.number().int().min(0).max(9).default(0),
  rooms: z.number().int().min(1).max(9).default(1),
};
export const refineHotelSearch = (v: { checkIn: string; checkOut: string }, ctx: z.RefinementCtx): void => {
  if (v.checkOut <= v.checkIn) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Check-out must be after check-in.' });
};
export const hotelSearchInput = z.object({ kind: z.literal('hotels'), ...hotelSearchFields }).superRefine(refineHotelSearch);
export type HotelSearchInput = z.infer<typeof hotelSearchInput>;

export const travelSearchInput = z.discriminatedUnion('kind', [flightSearchInput, hotelSearchInput]);
export type TravelSearchInput = z.infer<typeof travelSearchInput>;

export const externalHandoffOutput = z.object({
  provider: z.string(),
  label: z.string(),
  url: z.string(),
  opensNewTab: z.boolean(),
  disclosure: z.string(),
});

export const searchMode = z.enum(['live', 'deep-link', 'unavailable']);
export type SearchMode = z.infer<typeof searchMode>;

const snapshotMeta = {
  provider: z.string(),
  retrievedAt: z.string(),
  ttlSeconds: z.number().int(),
  expiresAt: z.string(),
  /** Always true: the final price is the provider's, and prices move. */
  refreshBeforeBooking: z.literal(true),
};

export const flightOptionOutput = z.object({
  id: z.string(),
  carrier: z.string(),
  carrierCode: z.string().optional(),
  origin: z.string(),
  destination: z.string(),
  departAt: z.string(),
  arriveAt: z.string(),
  durationMinutes: z.number().int(),
  stops: z.number().int(),
  transfer: z.enum(['nonstop', 'protected', 'self_transfer']),
  transferLabel: z.string(),
  transferCaution: z.string().optional(),
  segments: z
    .array(z.object({ carrier: z.string(), carrierCode: z.string().optional(), flightNumber: z.string().optional(), origin: z.string(), destination: z.string(), departAt: z.string(), arriveAt: z.string() }))
    .optional(),
  priceCents: z.number().int().optional(),
  currency: z.string().optional(),
  pricedAt: z.string().optional(),
  bookingUrl: z.string().optional(),
  bookingProvider: z.string().optional(),
});
export type FlightOption = z.infer<typeof flightOptionOutput>;

export const flightSearchOutput = z.object({
  kind: z.literal('flights'),
  mode: searchMode,
  provider: z.string(),
  request: z.object({ origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string().optional(), adults: z.number().int(), children: z.number().int(), cabin: z.enum(FLIGHT_CABINS), nonstopOnly: z.boolean() }),
  airports: z.array(z.object({ code: z.string(), name: z.string(), note: z.string().nullable(), pending: z.string().nullable() })),
  snapshot: z.object({ ...snapshotMeta, results: z.array(flightOptionOutput) }).optional(),
  handoffs: z.array(externalHandoffOutput),
  /** Guest-safe reason when `mode` is not `live`. */
  notice: z.string().optional(),
  retryAfterMs: z.number().int().optional(),
});
export type FlightSearchOutcome = z.infer<typeof flightSearchOutput>;

export const hotelOptionOutput = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  walkMinutesToVenue: z.number().int().optional(),
  nightlyCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  currency: z.string().optional(),
  pricedAt: z.string().optional(),
  bookingUrl: z.string().optional(),
  isVenue: z.boolean().optional(),
});
export type HotelOption = z.infer<typeof hotelOptionOutput>;

export const hotelSearchOutput = z.object({
  kind: z.literal('hotels'),
  mode: searchMode,
  provider: z.string(),
  request: z.object({ checkIn: z.string(), checkOut: z.string(), adults: z.number().int(), children: z.number().int(), rooms: z.number().int() }),
  snapshot: z.object({ ...snapshotMeta, results: z.array(hotelOptionOutput) }).optional(),
  handoffs: z.array(externalHandoffOutput),
  notice: z.string().optional(),
  retryAfterMs: z.number().int().optional(),
});
export type HotelSearchOutcome = z.infer<typeof hotelSearchOutput>;

export const travelSearchOutput = z.discriminatedUnion('kind', [flightSearchOutput, hotelSearchOutput]);
export type TravelSearchOutcome = z.infer<typeof travelSearchOutput>;

// ---------------------------------------------------------------- hotels (curated)

export const hotelReasonSchema = z.object({
  kind: z.enum(HOTEL_REASON_KINDS),
  text: z.string().trim().min(1).max(160),
  value: z.union([z.number(), z.string().max(40)]).optional(),
});

export const roomBlockSchema = z.object({
  url: externalUrl.nullable().default(null),
  code: z.string().trim().max(40).nullable().default(null),
  rateText: z.string().trim().max(80).nullable().default(null),
  checkIn: isoDate.nullable().default(null),
  checkOut: isoDate.nullable().default(null),
  cutoff: isoDate.nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
  pending: z.string().trim().max(300).nullable().default(null),
  placeholder: z.boolean().default(true),
});
export type RoomBlockInput = z.infer<typeof roomBlockSchema>;

export const hotelRecommendationInput = z.object({
  id: ulid.optional(),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(200).nullable().default(null),
  isVenue: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  reasons: z.array(hotelReasonSchema).max(8).default([]),
  priceBand: z.enum(PRICE_BANDS).nullable().default(null),
  walkMinutesToVenue: z.number().int().min(0).max(180).nullable().default(null),
  websiteUrl: externalUrl.nullable().default(null),
  bookingUrl: externalUrl.nullable().default(null),
  block: roomBlockSchema.nullable().default(null),
  placeholder: z.boolean().default(false),
  active: z.boolean().default(true),
  sourceId: z.string().trim().max(64).nullable().default(null),
  /** ISO time an admin last verified the row; defaults to now. */
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
});
export type HotelRecommendationInput = z.infer<typeof hotelRecommendationInput>;

export const hotelRecommendationOutput = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  isVenue: z.boolean(),
  sortOrder: z.number().int(),
  reasons: z.array(hotelReasonSchema),
  priceBand: z.enum(PRICE_BANDS).nullable(),
  walkMinutesToVenue: z.number().int().nullable(),
  websiteUrl: z.string().nullable(),
  bookingUrl: z.string().nullable(),
  block: roomBlockSchema.nullable(),
  placeholder: z.boolean(),
  active: z.boolean(),
  sourceId: z.string().nullable(),
  verifiedAt: z.string(),
  contentVersion: z.number().int(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'not_yet_valid']),
  /** True when this row was synthesised from the brief because no admin row exists yet. */
  synthesized: z.boolean(),
});
export type HotelRecommendation = z.infer<typeof hotelRecommendationOutput>;

// ---------------------------------------------------------------- admin travel links

export const travelLinkInput = z.object({
  id: ulid.optional(),
  category: z.enum(TRAVEL_LINK_CATEGORIES),
  provider: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  url: externalUrl,
  note: z.string().trim().max(200).nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  active: z.boolean().default(true),
});
export type TravelLinkInput = z.infer<typeof travelLinkInput>;

export const travelLinkOutput = z.object({
  id: z.string(),
  category: z.enum(TRAVEL_LINK_CATEGORIES),
  provider: z.string(),
  label: z.string(),
  url: z.string(),
  note: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  verifiedAt: z.string(),
});
export type TravelLink = z.infer<typeof travelLinkOutput>;

// ---------------------------------------------------------------- trip bridge

export const itineraryDetailsInput = z
  .object({
    origin: iata.optional(),
    destination: iata.optional(),
    carrier: z.string().trim().max(60).optional(),
    flightNumber: z.string().trim().max(12).optional(),
    hotelName: z.string().trim().max(120).optional(),
    address: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const tripItemInput = z.object({
  kind: z.enum(ITINERARY_KINDS),
  title: z.string().trim().min(1).max(120),
  startAt: whenInput,
  endAt: whenInput.optional(),
  timezone: timezoneInput,
  provider: z.string().trim().min(1).max(40).optional(),
  providerRef: z.string().trim().min(1).max(64).optional(),
  details: itineraryDetailsInput.default({}),
});
export type TripItemInput = z.infer<typeof tripItemInput>;

export const tripItemOutput = z.object({
  id: z.string(),
  guestId: z.string(),
  kind: z.enum(ITINERARY_KINDS),
  status: z.enum(ITINERARY_STATUSES),
  title: z.string(),
  provider: z.string().nullable(),
  providerRef: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string().nullable(),
  timezone: z.string(),
  details: itineraryDetailsInput,
  confirmedVia: z.enum(['guest', 'webhook']).nullable(),
  confirmedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type TripItem = z.infer<typeof tripItemOutput>;

export const FREE_TIME_BUCKETS = ['friday_afternoon', 'saturday_morning', 'sunday', 'short', 'long'] as const;
export const freeTimeWindowOutput = z.object({
  startAt: z.string(),
  endAt: z.string(),
  minutes: z.number().int(),
  /** Share an Adventure itinerary bucket (brief §6). */
  bucket: z.enum(FREE_TIME_BUCKETS),
  label: z.string(),
});
export type FreeTimeWindow = z.infer<typeof freeTimeWindowOutput>;
