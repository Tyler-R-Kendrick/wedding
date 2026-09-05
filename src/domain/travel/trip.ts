import { and, asc, eq, inArray } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId, type GuestId, type HouseholdId } from '@/contracts/ids';
import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guestItineraryItems, type ConfirmationSource, type GuestItineraryItemRow, type ItineraryDetails, type ItineraryStatus } from '@/db/schema/travel';
import type { FreeTimeWindow, TripItem, TripItemInput } from './types';

/**
 * The trip bridge: guests record or confirm itinerary items. An item becomes `confirmed` only
 * through `confirmTripItem` with `via: 'guest'` (the guest pressed "I booked this" on the site)
 * or `via: 'webhook'` (a signed provider event matched the item). Opening a deep link never
 * changes status. Free-time windows between items feed Share an Adventure.
 */
const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, second: +p.second!, weekday: WEEKDAYS[p.weekday!] ?? 0 };
}

/** Wall time in `timeZone` -> instant (DST edge: resolved to the offset in force one hour earlier). */
export function zonedToUtc(local: string, timeZone: string): Date {
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, m, d] = datePart!.split('-').map(Number);
  const [hh, mm, ss = 0] = timePart.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!, ss);
  const z = zonedParts(new Date(guess), timeZone);
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return new Date(guess - (asIfUtc - guess));
}

/** Accepts an ISO instant, a wall time ("YYYY-MM-DDTHH:mm") in `timeZone`, or a date (midnight in `timeZone`). */
export function parseWhen(input: string, timeZone: string): Date | null {
  const s = input.trim();
  if (OFFSET.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (LOCAL.test(s) || DATE_ONLY.test(s)) {
    const d = zonedToUtc(s, timeZone);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

export function toTripItem(row: GuestItineraryItemRow): TripItem {
  return {
    id: row.id,
    guestId: row.guestId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    provider: row.provider,
    providerRef: row.providerRef,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    timezone: row.timezone,
    details: row.details,
    confirmedVia: row.confirmedVia,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTripItems(db: Db, guestIds: readonly GuestId[]): Promise<TripItem[]> {
  if (guestIds.length === 0) return [];
  const rows = await db.select().from(guestItineraryItems).where(inArray(guestItineraryItems.guestId, [...guestIds])).orderBy(asc(guestItineraryItems.startAt));
  return rows.map(toTripItem);
}

export async function getTripItemRow(db: Db, id: string): Promise<GuestItineraryItemRow | null> {
  const rows = await db.select().from(guestItineraryItems).where(eq(guestItineraryItems.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Items a hosted session or webhook may refer to: by our id (the session reference) or by provider reference. */
export async function findTripItemByReference(db: Db, reference: string): Promise<GuestItineraryItemRow | null> {
  const byId = await getTripItemRow(db, reference);
  if (byId) return byId;
  const rows = await db.select().from(guestItineraryItems).where(eq(guestItineraryItems.providerRef, reference)).limit(1);
  return rows[0] ?? null;
}

function resolveTimes(input: Pick<TripItemInput, 'startAt' | 'endAt' | 'timezone'>): Result<{ startAt: Date; endAt: Date | null }, CapabilityError> {
  const startAt = parseWhen(input.startAt, input.timezone);
  if (!startAt) return err(new CapabilityError('validation', 'Please check the start date and time.', { issues: [{ path: 'startAt', message: 'unreadable date/time' }] }));
  const endAt = input.endAt ? parseWhen(input.endAt, input.timezone) : null;
  if (input.endAt && !endAt) return err(new CapabilityError('validation', 'Please check the end date and time.', { issues: [{ path: 'endAt', message: 'unreadable date/time' }] }));
  if (endAt && endAt.getTime() < startAt.getTime()) return err(new CapabilityError('validation', 'The end must be after the start.', { issues: [{ path: 'endAt', message: 'before start' }] }));
  return ok({ startAt, endAt });
}

export async function addTripItem(
  db: Db,
  args: { guestId: GuestId; householdId: HouseholdId; input: TripItemInput; actor: PrincipalRef; now: Date; id?: string; status?: ItineraryStatus },
): Promise<Result<TripItem, CapabilityError>> {
  const times = resolveTimes(args.input);
  if (!times.ok) return times;
  const [row] = await db
    .insert(guestItineraryItems)
    .values({
      id: args.id ?? newId(),
      guestId: args.guestId,
      householdId: args.householdId,
      kind: args.input.kind,
      status: args.status ?? 'planned',
      title: args.input.title,
      provider: args.input.provider ?? null,
      providerRef: args.input.providerRef ?? null,
      startAt: times.value.startAt,
      endAt: times.value.endAt,
      timezone: args.input.timezone,
      details: args.input.details,
      createdBy: args.actor,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning();
  return ok(toTripItem(row!));
}

export async function updateTripItem(db: Db, args: { id: string; input: TripItemInput; now: Date }): Promise<Result<TripItem, CapabilityError>> {
  const times = resolveTimes(args.input);
  if (!times.ok) return times;
  const [row] = await db
    .update(guestItineraryItems)
    .set({
      kind: args.input.kind,
      title: args.input.title,
      provider: args.input.provider ?? null,
      providerRef: args.input.providerRef ?? null,
      startAt: times.value.startAt,
      endAt: times.value.endAt,
      timezone: args.input.timezone,
      details: args.input.details,
      updatedAt: args.now,
    })
    .where(eq(guestItineraryItems.id, args.id))
    .returning();
  return row ? ok(toTripItem(row)) : err(new CapabilityError('not_found', 'That trip item no longer exists.'));
}

/** The only path to `confirmed`. `via` records who said so; a deep-link click is never a `via`. */
export async function confirmTripItem(
  db: Db,
  args: { id: string; via: ConfirmationSource; now: Date; provider?: string; providerRef?: string; details?: Partial<ItineraryDetails>; startAt?: Date; endAt?: Date },
): Promise<Result<TripItem, CapabilityError>> {
  const existing = await getTripItemRow(db, args.id);
  if (!existing) return err(new CapabilityError('not_found', 'That trip item no longer exists.'));
  if (existing.status === 'cancelled') return err(new CapabilityError('conflict', 'That trip item was cancelled. Add it again to confirm it.'));
  const [row] = await db
    .update(guestItineraryItems)
    .set({
      status: 'confirmed',
      confirmedVia: args.via,
      confirmedAt: args.now,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.providerRef ? { providerRef: args.providerRef } : {}),
      ...(args.details ? { details: { ...existing.details, ...stripUndefined(args.details) } } : {}),
      ...(args.startAt ? { startAt: args.startAt } : {}),
      ...(args.endAt ? { endAt: args.endAt } : {}),
      updatedAt: args.now,
    })
    .where(eq(guestItineraryItems.id, args.id))
    .returning();
  return ok(toTripItem(row!));
}

export async function setTripItemStatus(db: Db, args: { id: string; status: Exclude<ItineraryStatus, 'confirmed'>; now: Date }): Promise<Result<TripItem, CapabilityError>> {
  const [row] = await db
    .update(guestItineraryItems)
    .set({ status: args.status, ...(args.status === 'planned' ? { confirmedVia: null, confirmedAt: null } : {}), updatedAt: args.now })
    .where(eq(guestItineraryItems.id, args.id))
    .returning();
  return row ? ok(toTripItem(row)) : err(new CapabilityError('not_found', 'That trip item no longer exists.'));
}

export async function removeTripItem(db: Db, id: string, guestIds?: readonly GuestId[]): Promise<boolean> {
  const where = guestIds ? and(eq(guestItineraryItems.id, id), inArray(guestItineraryItems.guestId, [...guestIds])) : eq(guestItineraryItems.id, id);
  const rows = await db.delete(guestItineraryItems).where(where).returning({ id: guestItineraryItems.id });
  return rows.length > 0;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------- free time -> Share an Adventure

export const MIN_FREE_MINUTES = 45;

interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function bucketFor(start: Date, minutes: number, timeZone: string): FreeTimeWindow['bucket'] {
  const z = zonedParts(start, timeZone);
  if (z.weekday === 5 && z.hour >= 11 && z.hour < 18) return 'friday_afternoon';
  if (z.weekday === 6 && z.hour < 12) return 'saturday_morning';
  if (z.weekday === 0) return 'sunday';
  return minutes < 180 ? 'short' : 'long';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function windowLabel(start: Date, minutes: number, bucket: FreeTimeWindow['bucket'], timeZone: string): string {
  const z = zonedParts(start, timeZone);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const dur = h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  const when = bucket === 'friday_afternoon' ? 'Friday afternoon' : bucket === 'saturday_morning' ? 'Saturday morning' : bucket === 'sunday' ? 'Sunday' : `${DAY_NAMES[z.weekday]} from ${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
  return `${when}: ${dur} free`;
}

/**
 * Gaps between the guest's flights and other timed items, inside their stay, excluding the
 * wedding day itself (times are `TODO(Tyler & Sara)`, so the whole day is treated as taken).
 * Hotel stays are lodging, not busy time. Windows under 45 minutes are dropped.
 */
export function freeTimeWindows(
  items: readonly TripItem[],
  opts: { weddingDate?: string; timeZone?: string; minMinutes?: number } = {},
): FreeTimeWindow[] {
  const tz = opts.timeZone ?? WEDDING_TIMEZONE;
  const weddingDate = opts.weddingDate ?? WEDDING_DATE_ISO;
  const min = opts.minMinutes ?? MIN_FREE_MINUTES;
  const live = items.filter((i) => i.status !== 'cancelled');
  const flights = live.filter((i) => i.kind === 'flight');
  if (flights.length === 0) return [];
  const arrivals = flights.map((f) => Date.parse(f.endAt ?? f.startAt));
  const departures = flights.map((f) => Date.parse(f.startAt));
  const spanStart = Math.min(...arrivals);
  let spanEnd = Math.max(...departures);
  const weddingStart = zonedToUtc(`${weddingDate}T00:00`, tz).getTime();
  const weddingEnd = weddingStart + 86_400_000;
  if (spanEnd <= spanStart) spanEnd = Math.max(spanStart, weddingEnd);
  const busy: Interval[] = [{ start: weddingStart, end: weddingEnd }];
  for (const i of live) {
    if (i.kind === 'hotel') continue;
    const start = Date.parse(i.startAt);
    const end = i.endAt ? Date.parse(i.endAt) : start + 60 * 60_000;
    busy.push({ start, end });
  }
  const merged = mergeIntervals(busy);
  const out: FreeTimeWindow[] = [];
  let cursor = spanStart;
  for (const b of merged) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) push(cursor, Math.min(b.start, spanEnd));
    cursor = Math.max(cursor, b.end);
    if (cursor >= spanEnd) break;
  }
  if (cursor < spanEnd) push(cursor, spanEnd);
  return out;

  function push(start: number, end: number) {
    const minutes = Math.floor((end - start) / 60_000);
    if (minutes < min) return;
    const s = new Date(start);
    const bucket = bucketFor(s, minutes, tz);
    out.push({ startAt: s.toISOString(), endAt: new Date(end).toISOString(), minutes, bucket, label: windowLabel(s, minutes, bucket, tz) });
  }
}
