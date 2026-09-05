import { eq } from 'drizzle-orm';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { guestTravelProfiles, type GuestTravelProfileRow } from '@/db/schema/travel';
import type { LocationSuggestion, TravelProfile, TravelProfileInput } from './types';

/**
 * Opt-in travel profile. One row per guest; saving it is the opt-in, deleting it withdraws it.
 * Nothing is ever inferred from the request (no IP geolocation): the only suggestion source is
 * the invitation's mailing location, and even that is presented for the guest to confirm.
 */
export function toTravelProfile(row: GuestTravelProfileRow): TravelProfile {
  return {
    guestId: row.guestId,
    homeCity: row.homeCity,
    homeRegion: row.homeRegion,
    preferredAirport: row.preferredAirport,
    alternateAirports: row.alternateAirports,
    adults: row.adults,
    children: row.children,
    airlinePreference: row.airlinePreference,
    nonstopPreferred: row.nonstopPreferred,
    cabin: row.cabin,
    arriveEarliest: row.arriveEarliest,
    arriveLatest: row.arriveLatest,
    departEarliest: row.departEarliest,
    departLatest: row.departLatest,
    consentedAt: row.consentedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getTravelProfile(db: Db, guestId: GuestId): Promise<TravelProfile | null> {
  const rows = await db.select().from(guestTravelProfiles).where(eq(guestTravelProfiles.guestId, guestId)).limit(1);
  return rows[0] ? toTravelProfile(rows[0]) : null;
}

export async function upsertTravelProfile(db: Db, args: { guestId: GuestId; householdId: HouseholdId; input: TravelProfileInput; now: Date }): Promise<TravelProfile> {
  const { input, now } = args;
  const values = {
    guestId: args.guestId,
    householdId: args.householdId,
    homeCity: input.homeCity ?? null,
    homeRegion: input.homeRegion ?? null,
    preferredAirport: input.preferredAirport ?? null,
    alternateAirports: input.alternateAirports,
    adults: input.adults,
    children: input.children,
    airlinePreference: input.airlinePreference ?? null,
    nonstopPreferred: input.nonstopPreferred,
    cabin: input.cabin,
    arriveEarliest: input.arriveEarliest ?? null,
    arriveLatest: input.arriveLatest ?? null,
    departEarliest: input.departEarliest ?? null,
    departLatest: input.departLatest ?? null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(guestTravelProfiles)
    .values({ ...values, consentedAt: now, createdAt: now })
    .onConflictDoUpdate({ target: guestTravelProfiles.guestId, set: values })
    .returning();
  return toTravelProfile(row!);
}

export async function deleteTravelProfile(db: Db, guestId: GuestId): Promise<boolean> {
  const rows = await db.delete(guestTravelProfiles).where(eq(guestTravelProfiles.guestId, guestId)).returning({ guestId: guestTravelProfiles.guestId });
  return rows.length > 0;
}

export type LocationSuggestionResolver = (db: Db, guestId: GuestId) => Promise<LocationSuggestion | null>;

const g = globalThis as unknown as { __weddingTravelLocationResolver?: LocationSuggestionResolver };

/**
 * Seam for the identity swarm: when invitations carry a mailing city/state, install a resolver
 * that maps it to a suggestion. Until then there is no suggestion (never an IP guess).
 */
export function setLocationSuggestionResolver(resolver: LocationSuggestionResolver | undefined): void {
  g.__weddingTravelLocationResolver = resolver;
}

export async function getInvitationLocationSuggestion(db: Db, guestId: GuestId): Promise<LocationSuggestion | null> {
  const resolver = g.__weddingTravelLocationResolver;
  if (!resolver) return null;
  try {
    return await resolver(db, guestId);
  } catch {
    return null;
  }
}
