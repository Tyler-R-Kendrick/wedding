import { asc, eq } from 'drizzle-orm';
import type { ContentSourceId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { reservationVenues, type ReservationVenueRow } from '@/db/schema';
import { seedId } from '@/db/seed/sources';

export interface UpsertReservationVenueInput {
  id: string;
  name: string;
  placeRef?: string;
  resySlug?: string;
  openTableId?: string;
  url?: string;
  note?: string;
  placeholder?: boolean;
  active?: boolean;
  sortOrder?: number;
  sourceId?: string;
  verifiedAt?: Date;
  updatedBy: PrincipalRef;
}

export async function upsertReservationVenue(db: Db, input: UpsertReservationVenueInput, now: Date = new Date()): Promise<ReservationVenueRow> {
  const values = {
    id: input.id,
    name: input.name,
    placeRef: input.placeRef ?? null,
    resySlug: input.resySlug ?? null,
    openTableId: input.openTableId ?? null,
    url: input.url ?? null,
    note: input.note ?? null,
    placeholder: input.placeholder ?? false,
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
    sourceId: input.sourceId ?? null,
    verifiedAt: input.verifiedAt ?? null,
    updatedBy: input.updatedBy,
    createdAt: now,
    updatedAt: now,
  };
  const { id: _id, createdAt: _c, ...update } = values;
  const [row] = await db.insert(reservationVenues).values(values).onConflictDoUpdate({ target: reservationVenues.id, set: update }).returning();
  return row!;
}

export async function listReservationVenueRows(db: Db, opts: { includeInactive?: boolean } = {}): Promise<ReservationVenueRow[]> {
  return db
    .select()
    .from(reservationVenues)
    .where(opts.includeInactive ? undefined : eq(reservationVenues.active, true))
    .orderBy(asc(reservationVenues.sortOrder), asc(reservationVenues.id));
}

export async function getReservationVenueRow(db: Db, id: string): Promise<ReservationVenueRow | null> {
  const rows = await db.select().from(reservationVenues).where(eq(reservationVenues.id, id)).limit(1);
  return rows[0] ?? null;
}

const BRIEF_VERIFIED_AT = new Date('2026-09-04T00:00:00.000Z');
const SYSTEM: PrincipalRef = { kind: 'system', component: 'defaults' };

/**
 * Built-in venues until admins configure real ones. Only brief facts: Cindy's is an outlet
 * listed on chicagoathletichotel.com (its reservation link is not known); the second row is
 * an explicit placeholder that exercises the honest "unavailable" rung.
 */
export const DEFAULT_RESERVATION_VENUES: readonly ReservationVenueRow[] = [
  {
    id: 'caa-cindys',
    name: 'Cindy’s (rooftop at the Chicago Athletic Association)',
    placeRef: null,
    resySlug: null,
    openTableId: null,
    url: 'https://www.chicagoathletichotel.com/',
    note: 'TODO(Tyler & Sara): reservation link for Cindy’s (backlog P-07). Until then the hotel’s site lists its outlets.',
    placeholder: true,
    active: true,
    sortOrder: 0,
    sourceId: seedId<ContentSourceId>(103),
    verifiedAt: BRIEF_VERIFIED_AT,
    updatedBy: SYSTEM,
    createdAt: BRIEF_VERIFIED_AT,
    updatedAt: BRIEF_VERIFIED_AT,
  },
  {
    id: 'placeholder-restaurant',
    name: 'TODO(Tyler & Sara): a restaurant we love',
    placeRef: null,
    resySlug: null,
    openTableId: null,
    url: null,
    note: 'A place from our memory list, once we have picked it (backlog C-08).',
    placeholder: true,
    active: true,
    sortOrder: 1,
    sourceId: seedId<ContentSourceId>(101),
    verifiedAt: BRIEF_VERIFIED_AT,
    updatedBy: SYSTEM,
    createdAt: BRIEF_VERIFIED_AT,
    updatedAt: BRIEF_VERIFIED_AT,
  },
];

/** Admin rows when any exist, else the built-in defaults. */
export async function listReservationVenues(db: Db): Promise<ReservationVenueRow[]> {
  const rows = await listReservationVenueRows(db);
  return rows.length ? rows : [...DEFAULT_RESERVATION_VENUES];
}

export async function getReservationVenue(db: Db, id: string): Promise<ReservationVenueRow | null> {
  const row = await getReservationVenueRow(db, id);
  if (row) return row.active ? row : null;
  const rows = await listReservationVenueRows(db);
  if (rows.length) return null; // admins configured venues: defaults are no longer offered
  return DEFAULT_RESERVATION_VENUES.find((v) => v.id === id) ?? null;
}
