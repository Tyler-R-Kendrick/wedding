import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { Db } from '@/db/client';
import { events, floorPlans, rsvpSettings } from '@/db/schema';
import { seedId } from '@/db/seed/ids';
import { BRIEF_SOURCE_ID } from '@/db/seed/sources';
import { PLACEHOLDER_PLANS } from '@/domain/seating/plans';

/**
 * The three events the design doc names (ceremony, cocktail hour, reception). Only the date is a
 * brief fact; room, times, dress code stay NULL with `placeholder: true` — TODO(Tyler & Sara).
 * Idempotent: rows are inserted once and never overwrite admin edits.
 */
export const SEED_EVENTS = [
  { id: seedId('EVENTCEREMONY'), slug: 'ceremony', name: 'Ceremony', sortOrder: 10, hasMeal: false },
  { id: seedId('EVENTCOCKTAILS'), slug: 'cocktail-hour', name: 'Cocktail hour', sortOrder: 20, hasMeal: false },
  { id: seedId('EVENTRECEPTION'), slug: 'reception', name: 'Reception', sortOrder: 30, hasMeal: true },
] as const;

export const SEED_EVENT_IDS = { ceremony: SEED_EVENTS[0].id, cocktailHour: SEED_EVENTS[1].id, reception: SEED_EVENTS[2].id } as const;

export async function seedEventsAndPlans(db: Db, now: Date = new Date()): Promise<void> {
  for (const e of SEED_EVENTS) {
    await db
      .insert(events)
      .values({
        id: e.id,
        slug: e.slug,
        name: e.name,
        description: 'TODO(Tyler & Sara): what happens, and what to expect.',
        dateIso: WEDDING_DATE_ISO,
        startsAt: null,
        endsAt: null,
        timezone: WEDDING_TIMEZONE,
        venueSpaceRef: null,
        dressCode: null,
        accessibilityNote: null,
        placeholder: true,
        rsvpRequired: true,
        hasMeal: e.hasMeal,
        mealOptionsVersion: 0,
        sortOrder: e.sortOrder,
        sourceId: BRIEF_SOURCE_ID,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: events.id });
  }
  await db.insert(rsvpSettings).values({ id: 'current', mode: 'auto', deadlineAt: null, note: 'Deadline TODO(Tyler & Sara)', updatedBy: { kind: 'system', component: 'seed' }, updatedAt: now }).onConflictDoNothing();
  for (const p of PLACEHOLDER_PLANS) {
    await db
      .insert(floorPlans)
      .values({ id: p.id, venueSpaceRef: p.venueSpaceRef, name: p.name, viewBox: p.viewBox, outline: p.outline, anchors: p.anchors, placeholder: true, sourceId: BRIEF_SOURCE_ID, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: floorPlans.id });
  }
}
