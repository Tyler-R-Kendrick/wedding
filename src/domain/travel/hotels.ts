import { asc, desc, eq } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId, type ContentSourceId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { FRESHNESS_POLICIES, freshnessOf } from '@/contracts/provenance';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { hotelRecommendations, type HotelRecommendationRow } from '@/db/schema/travel';
import { seedId } from '@/db/seed/sources';
import { assertAllowedRedirect } from '@/lib/redirects';
import { BRIEF_VERIFIED_AT, CAA_KIT_SOURCE_ID, DEFAULT_VENUE_BLOCK, VENUE } from './facts';
import type { HotelRecommendation, HotelRecommendationInput } from './types';

/**
 * Curated hotels. The venue block comes first, always: when no admin row exists yet the row is
 * synthesised from the brief with `placeholder: true` so the page is honest, never empty. Every
 * URL is checked against the redirect allowlist when written AND when read (a shrunken allowlist
 * hides a link rather than leaking it).
 */
export const VENUE_HOTEL_ID = seedId(801);

const allowedOrNull = (url: string | null | undefined): string | null => (url && assertAllowedRedirect(url).ok ? url : null);

export function toHotelRecommendation(row: HotelRecommendationRow, now: Date, synthesized = false): HotelRecommendation {
  const verifiedAt = row.verifiedAt.toISOString();
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    isVenue: row.isVenue,
    sortOrder: row.sortOrder,
    reasons: row.reasons,
    priceBand: row.priceBand,
    walkMinutesToVenue: row.walkMinutesToVenue,
    websiteUrl: allowedOrNull(row.websiteUrl),
    bookingUrl: allowedOrNull(row.bookingUrl),
    block: row.block ? { ...row.block, url: allowedOrNull(row.block.url) } : null,
    placeholder: row.placeholder,
    active: row.active,
    sourceId: row.sourceId,
    verifiedAt,
    contentVersion: row.contentVersion,
    freshness: freshnessOf({ verifiedAt }, FRESHNESS_POLICIES.operational, now),
    synthesized,
  };
}

/** The CAA row from brief facts only (no rate, no link, no dates). */
export function synthesizedVenueHotel(now: Date): HotelRecommendation {
  return toHotelRecommendation(
    {
      id: VENUE_HOTEL_ID,
      name: VENUE.name,
      address: VENUE.address,
      isVenue: true,
      sortOrder: 0,
      reasons: [{ kind: 'walk_minutes', text: 'The wedding is here: no travel on the day.', value: 0 }],
      priceBand: null,
      walkMinutesToVenue: 0,
      websiteUrl: VENUE.url,
      bookingUrl: null,
      block: DEFAULT_VENUE_BLOCK,
      placeholder: true,
      active: true,
      sourceId: CAA_KIT_SOURCE_ID,
      verifiedAt: new Date(BRIEF_VERIFIED_AT),
      contentVersion: 0,
      updatedBy: { kind: 'system', component: 'brief' },
      createdAt: new Date(BRIEF_VERIFIED_AT),
      updatedAt: new Date(BRIEF_VERIFIED_AT),
    },
    now,
    true,
  );
}

export async function listHotels(db: Db, opts: { includeInactive?: boolean; now: Date }): Promise<HotelRecommendation[]> {
  const rows = await db
    .select()
    .from(hotelRecommendations)
    .where(opts.includeInactive ? undefined : eq(hotelRecommendations.active, true))
    .orderBy(desc(hotelRecommendations.isVenue), asc(hotelRecommendations.sortOrder), asc(hotelRecommendations.name));
  const list = rows.map((r) => toHotelRecommendation(r, opts.now));
  if (!list.some((h) => h.isVenue && h.active)) list.unshift(synthesizedVenueHotel(opts.now));
  return list;
}

export async function getHotel(db: Db, id: string, now: Date): Promise<HotelRecommendation | null> {
  const rows = await db.select().from(hotelRecommendations).where(eq(hotelRecommendations.id, id)).limit(1);
  if (rows[0]) return toHotelRecommendation(rows[0], now);
  return id === VENUE_HOTEL_ID ? synthesizedVenueHotel(now) : null;
}

/** The venue hotel with its room block (admin row when present, otherwise the brief placeholder). */
export async function getVenueHotel(db: Db, now: Date): Promise<HotelRecommendation> {
  const list = await listHotels(db, { now });
  return list.find((h) => h.isVenue) ?? synthesizedVenueHotel(now);
}

export function validateHotelUrls(input: HotelRecommendationInput): Result<void, CapabilityError> {
  const issues: { path: string; message: string }[] = [];
  const check = (path: string, url: string | null | undefined) => {
    if (!url) return;
    const r = assertAllowedRedirect(url);
    if (!r.ok) issues.push({ path, message: r.error.message });
  };
  check('websiteUrl', input.websiteUrl);
  check('bookingUrl', input.bookingUrl);
  check('block.url', input.block?.url);
  return issues.length ? err(new CapabilityError('validation', 'Some links are not on our list of trusted partners.', { issues })) : ok(undefined);
}

export async function saveHotel(db: Db, args: { input: HotelRecommendationInput; actor: PrincipalRef; now: Date }): Promise<Result<HotelRecommendation, CapabilityError>> {
  const { input, actor, now } = args;
  const urls = validateHotelUrls(input);
  if (!urls.ok) return urls;
  const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : now;
  const values = {
    name: input.name,
    address: input.address,
    isVenue: input.isVenue,
    sortOrder: input.sortOrder,
    reasons: input.reasons,
    priceBand: input.priceBand,
    walkMinutesToVenue: input.walkMinutesToVenue,
    websiteUrl: input.websiteUrl,
    bookingUrl: input.bookingUrl,
    block: input.block,
    placeholder: input.placeholder,
    active: input.active,
    sourceId: input.sourceId as ContentSourceId | null,
    verifiedAt,
    updatedBy: actor,
    updatedAt: now,
  };
  const existing = input.id ? (await db.select().from(hotelRecommendations).where(eq(hotelRecommendations.id, input.id)).limit(1))[0] : undefined;
  if (existing) {
    const [row] = await db
      .update(hotelRecommendations)
      .set({ ...values, contentVersion: existing.contentVersion + 1 })
      .where(eq(hotelRecommendations.id, existing.id))
      .returning();
    return ok(toHotelRecommendation(row!, now));
  }
  const [row] = await db
    .insert(hotelRecommendations)
    .values({ ...values, id: input.id ?? newId(), contentVersion: 1, createdAt: now })
    .returning();
  return ok(toHotelRecommendation(row!, now));
}

export async function removeHotel(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(hotelRecommendations).where(eq(hotelRecommendations.id, id)).returning({ id: hotelRecommendations.id });
  return rows.length > 0;
}
