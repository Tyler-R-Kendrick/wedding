import { asc, eq, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { ContentSourceId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { reservationVenues, type ReservationVenueRow } from '@/db/schema';
import { seedId } from '@/db/seed/sources';

/**
 * A field left `undefined` keeps what the row already holds; `null` clears it. Only a first save
 * (an insert) falls back to defaults: shown, not a placeholder, first in order, no links.
 */
export interface UpsertReservationVenueInput {
  id: string;
  name: string;
  placeRef?: string | null;
  resySlug?: string | null;
  openTableId?: string | null;
  url?: string | null;
  note?: string | null;
  placeholder?: boolean;
  active?: boolean;
  sortOrder?: number;
  sourceId?: string | null;
  verifiedAt?: Date | null;
  updatedBy: PrincipalRef;
}

/**
 * Creates or changes one place. The admin console never sees a place's `sourceId` (its citation),
 * so overwriting the whole row lost it on every edit, Hide and move: a field the caller left out
 * keeps its current value.
 */
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
  const update = definedOnly({
    name: input.name,
    placeRef: input.placeRef,
    resySlug: input.resySlug,
    openTableId: input.openTableId,
    url: input.url,
    note: input.note,
    placeholder: input.placeholder,
    active: input.active,
    sortOrder: input.sortOrder,
    sourceId: input.sourceId,
    verifiedAt: input.verifiedAt,
    updatedBy: input.updatedBy,
    updatedAt: now,
  });
  const set: Omit<typeof update, 'verifiedAt'> & { verifiedAt?: Date | null | SQL } = update;
  // A saved check vouches for the links it checked. With no word on the check (no `verifiedAt`, which
  // is also what `confirmed` becomes), a booking link that now differs from the saved one clears it:
  // keeping it would say the new link was checked. Links sent back unchanged (Hide, Up, Down) keep it.
  if (input.verifiedAt === undefined) {
    const changed = linkChanges([
      [reservationVenues.url, input.url],
      [reservationVenues.resySlug, input.resySlug],
      [reservationVenues.openTableId, input.openTableId],
    ]);
    if (changed) set.verifiedAt = sql`case when ${changed} then null else ${reservationVenues.verifiedAt} end`;
  }
  const [row] = await db.insert(reservationVenues).values(values).onConflictDoUpdate({ target: reservationVenues.id, set }).returning();
  return row!;
}

/** True (in SQL) when any supplied link differs from the saved one; `undefined` (left out, so kept) never counts. Null when none was supplied. */
function linkChanges(pairs: ReadonlyArray<readonly [AnyColumn, string | null | undefined]>): SQL | undefined {
  const tests = pairs.filter(([, v]) => v !== undefined).map(([col, v]) => sql`${col} is distinct from ${v}`);
  return tests.length ? or(...tests) : undefined;
}

/** The fields a caller actually supplied (`null` included), so an upsert never overwrites a value with "not given". */
function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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

/** Deletes one saved place. True when there was a row to delete. Once none are left, guests see the built-in placeholders again. */
export async function deleteReservationVenue(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(reservationVenues).where(eq(reservationVenues.id, id)).returning({ id: reservationVenues.id });
  return rows.length > 0;
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
