import { and, asc, eq, inArray, isNull, lte, or, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  eventEntitlements,
  events,
  mealOptions,
  rsvpSettings,
  weekendNotices,
  type EventEntitlementRow,
  type EventRow,
  type MealOptionRow,
  type RsvpSettingsRow,
  type WeekendNoticeRow,
} from '@/db/schema';

export async function listEvents(db: Db): Promise<EventRow[]> {
  return db.select().from(events).orderBy(asc(events.sortOrder), asc(events.name));
}

export async function getEvent(db: Db, id: string): Promise<EventRow | null> {
  return (await db.select().from(events).where(eq(events.id, id)).limit(1))[0] ?? null;
}

export async function listEntitlementsForGuests(db: Db, guestIds: readonly string[]): Promise<EventEntitlementRow[]> {
  if (guestIds.length === 0) return [];
  return db.select().from(eventEntitlements).where(inArray(eventEntitlements.guestId, [...guestIds]));
}

export async function listAllEntitlements(db: Db): Promise<EventEntitlementRow[]> {
  return db.select().from(eventEntitlements);
}

/** Every option ever published for these events (all versions); callers filter by the event's current version. */
export async function listMealOptionsForEvents(db: Db, eventIds: readonly string[]): Promise<MealOptionRow[]> {
  if (eventIds.length === 0) return [];
  return db
    .select()
    .from(mealOptions)
    .where(inArray(mealOptions.eventId, [...eventIds]))
    .orderBy(asc(mealOptions.eventId), asc(mealOptions.version), asc(mealOptions.sortOrder));
}

export const currentMealOptions = (event: Pick<EventRow, 'id' | 'mealOptionsVersion'>, all: readonly MealOptionRow[]): MealOptionRow[] =>
  all.filter((m) => m.eventId === event.id && m.version === event.mealOptionsVersion);

export async function getRsvpSettings(db: Db): Promise<RsvpSettingsRow> {
  const row = (await db.select().from(rsvpSettings).where(eq(rsvpSettings.id, 'current')).limit(1))[0];
  return row ?? { id: 'current', mode: 'auto', deadlineAt: null, note: null, updatedBy: null, updatedAt: new Date(0) };
}

/** Notices live for guests right now: active and inside their optional window. */
export async function listActiveNotices(db: Db, now: Date): Promise<WeekendNoticeRow[]> {
  return db
    .select()
    .from(weekendNotices)
    .where(
      and(
        eq(weekendNotices.active, true),
        or(isNull(weekendNotices.startsAt), lte(weekendNotices.startsAt, now)),
        or(isNull(weekendNotices.endsAt), gte(weekendNotices.endsAt, now)),
      ),
    )
    .orderBy(asc(weekendNotices.createdAt));
}

export async function listAllNotices(db: Db): Promise<WeekendNoticeRow[]> {
  return db.select().from(weekendNotices).orderBy(asc(weekendNotices.createdAt));
}
