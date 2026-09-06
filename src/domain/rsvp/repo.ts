import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { LifecycleState } from '@/contracts/lifecycle';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { getLifecycle } from '@/db/repos/site';
import { guestNeeds, guests, households, rsvpResponses, rsvpSettings, type EventEntitlementRow, type EventRow, type GuestNeedsRow, type GuestRow, type HouseholdRow, type MealOptionRow, type RsvpResponseRow, type RsvpWindowMode } from '@/db/schema';
import { computeRsvpWindow, getRsvpSettings, listEntitlementsForGuests, listEvents, listMealOptionsForEvents } from '@/domain/events';
import type { RsvpWindow } from '@/domain/events/window';
import type { HouseholdRsvpInput } from './types';

/** Everything the RSVP surfaces need for one set of guests, loaded in one place. */
export interface HouseholdRsvpContext {
  guests: GuestRow[];
  household: HouseholdRow | null;
  events: EventRow[];
  /** Only events at least one of `guests` is entitled to, in display order. */
  entitledEvents: EventRow[];
  entitlements: EventEntitlementRow[];
  mealOptions: MealOptionRow[];
  responses: RsvpResponseRow[];
  needs: GuestNeedsRow[];
  window: RsvpWindow;
  lifecycle: LifecycleState;
}

export async function listGuestsByIds(db: Db, ids: readonly string[]): Promise<GuestRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(guests).where(inArray(guests.id, [...ids])).orderBy(asc(guests.createdAt), asc(guests.lastName), asc(guests.firstName));
}

export async function listAllGuests(db: Db): Promise<GuestRow[]> {
  return db.select().from(guests).orderBy(asc(guests.householdId), asc(guests.createdAt));
}

export async function listHouseholds(db: Db): Promise<HouseholdRow[]> {
  return db.select().from(households);
}

export async function loadHouseholdRsvpContext(db: Db, input: { guestIds: readonly string[]; householdId?: string; now: Date }): Promise<HouseholdRsvpContext> {
  const [guestRows, events, entitlements, settings, lifecycleRow] = await Promise.all([
    listGuestsByIds(db, input.guestIds),
    listEvents(db),
    listEntitlementsForGuests(db, input.guestIds),
    getRsvpSettings(db),
    getLifecycle(db),
  ]);
  const householdId = input.householdId ?? guestRows[0]?.householdId;
  const household = householdId ? ((await db.select().from(households).where(eq(households.id, householdId)).limit(1))[0] ?? null) : null;
  const entitledIds = new Set(entitlements.map((e) => e.eventId));
  const entitledEvents = events.filter((e) => entitledIds.has(e.id));
  const [mealOptions, responses, needs] = await Promise.all([
    listMealOptionsForEvents(db, entitledEvents.map((e) => e.id)),
    input.guestIds.length ? db.select().from(rsvpResponses).where(inArray(rsvpResponses.guestId, [...input.guestIds])) : Promise.resolve([] as RsvpResponseRow[]),
    input.guestIds.length ? db.select().from(guestNeeds).where(inArray(guestNeeds.guestId, [...input.guestIds])) : Promise.resolve([] as GuestNeedsRow[]),
  ]);
  const lifecycle = lifecycleRow?.state ?? 'TEASER';
  return { guests: guestRows, household, events, entitledEvents, entitlements, mealOptions, responses, needs, window: computeRsvpWindow(settings, lifecycle, input.now), lifecycle };
}

/** Persists a normalized submission atomically. Needs are written to their own table and never returned. */
export async function persistHouseholdRsvp(
  db: Db,
  input: HouseholdRsvpInput,
  meta: { submittedBy: PrincipalRef; via: 'guest' | 'admin'; now: Date; mealVersionByEvent: ReadonlyMap<string, number> },
): Promise<{ responses: RsvpResponseRow[] }> {
  return db.transaction(async (tx) => {
    const out: RsvpResponseRow[] = [];
    for (const r of input.responses) {
      const values = {
        id: newId(),
        guestId: r.guestId,
        eventId: r.eventId,
        status: r.status,
        mealOptionId: r.mealOptionId,
        mealOptionsVersion: r.mealOptionId ? (meta.mealVersionByEvent.get(r.eventId) ?? null) : null,
        plusOneAttending: r.plusOne?.attending ?? false,
        plusOneName: r.plusOne?.attending ? r.plusOne.name : null,
        plusOneMealOptionId: r.plusOne?.attending ? r.plusOne.mealOptionId : null,
        version: 1,
        submittedBy: meta.submittedBy,
        submittedVia: meta.via,
        createdAt: meta.now,
        updatedAt: meta.now,
      };
      const [row] = await tx
        .insert(rsvpResponses)
        .values(values)
        .onConflictDoUpdate({
          target: [rsvpResponses.guestId, rsvpResponses.eventId],
          set: {
            status: values.status,
            mealOptionId: values.mealOptionId,
            mealOptionsVersion: values.mealOptionsVersion,
            plusOneAttending: values.plusOneAttending,
            plusOneName: values.plusOneName,
            plusOneMealOptionId: values.plusOneMealOptionId,
            version: sql`${rsvpResponses.version} + 1`,
            submittedBy: values.submittedBy,
            submittedVia: values.submittedVia,
            updatedAt: meta.now,
          },
        })
        .returning();
      out.push(row!);
    }
    for (const n of input.needs) {
      const values = { guestId: n.guestId, dietary: n.dietary, accessibility: n.accessibility, updatedBy: meta.submittedBy, createdAt: meta.now, updatedAt: meta.now };
      await tx
        .insert(guestNeeds)
        .values(values)
        .onConflictDoUpdate({ target: guestNeeds.guestId, set: { dietary: values.dietary, accessibility: values.accessibility, updatedBy: values.updatedBy, updatedAt: meta.now } });
    }
    return { responses: out };
  });
}

export async function listAllResponses(db: Db): Promise<RsvpResponseRow[]> {
  return db.select().from(rsvpResponses).orderBy(asc(rsvpResponses.eventId), asc(rsvpResponses.guestId));
}

/** Admin-only, explicit opt-in: needs are loaded only by callers that pass `includeNeeds: true`. */
export async function listAllNeeds(db: Db): Promise<GuestNeedsRow[]> {
  return db.select().from(guestNeeds);
}

export async function setRsvpWindow(db: Db, input: { mode: RsvpWindowMode; deadlineAt: Date | null; note: string | null; updatedBy: PrincipalRef; now: Date }) {
  const values = { id: 'current', mode: input.mode, deadlineAt: input.deadlineAt, note: input.note, updatedBy: input.updatedBy, updatedAt: input.now };
  const [row] = await db
    .insert(rsvpSettings)
    .values(values)
    .onConflictDoUpdate({ target: rsvpSettings.id, set: { mode: values.mode, deadlineAt: values.deadlineAt, note: values.note, updatedBy: values.updatedBy, updatedAt: values.updatedAt } })
    .returning();
  return row!;
}

export async function findResponse(db: Db, guestId: string, eventId: string): Promise<RsvpResponseRow | null> {
  return (await db.select().from(rsvpResponses).where(and(eq(rsvpResponses.guestId, guestId), eq(rsvpResponses.eventId, eventId))).limit(1))[0] ?? null;
}
