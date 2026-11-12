import { eq, inArray } from 'drizzle-orm';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { guestNeeds, rsvpResponses } from '@/db/schema';
import { guestTripPreferences } from '@/db/schema/travel';
import { listHouseholdMembers } from '@/domain/guests/repo';
import { hasPrefs, readPrefs, type TripPrefs, type TripRecords } from '@/domain/trip-planner/profile';

/**
 * What a guest set for the trip planner, kept with their guest record so it follows them from a
 * phone to a laptop. One row per guest; saving nothing at all deletes the row.
 */
export async function getTripPreferences(db: Db, guestId: GuestId): Promise<{ prefs: TripPrefs; updatedAt: string } | null> {
  const [row] = await db.select().from(guestTripPreferences).where(eq(guestTripPreferences.guestId, guestId)).limit(1);
  return row ? { prefs: readPrefs(row.prefs), updatedAt: row.updatedAt.toISOString() } : null;
}

export async function saveTripPreferences(db: Db, args: { guestId: GuestId; householdId: HouseholdId; prefs: TripPrefs; now: Date }): Promise<{ prefs: TripPrefs; updatedAt: string } | null> {
  if (!hasPrefs(args.prefs)) {
    await deleteTripPreferences(db, args.guestId);
    return null;
  }
  const [row] = await db
    .insert(guestTripPreferences)
    .values({ guestId: args.guestId, householdId: args.householdId, prefs: args.prefs, createdAt: args.now, updatedAt: args.now })
    // The household too: a guest moved to another one keeps their answers when the old one is removed.
    .onConflictDoUpdate({ target: guestTripPreferences.guestId, set: { householdId: args.householdId, prefs: args.prefs, updatedAt: args.now } })
    .returning();
  return { prefs: readPrefs(row!.prefs), updatedAt: row!.updatedAt.toISOString() };
}

export async function deleteTripPreferences(db: Db, guestId: GuestId): Promise<boolean> {
  const rows = await db.delete(guestTripPreferences).where(eq(guestTripPreferences.guestId, guestId)).returning({ guestId: guestTripPreferences.guestId });
  return rows.length > 0;
}

/**
 * What the site's own records say about a guest's party, for the planner: how many grown-ups and
 * children are on the invitation and have not said no, and what the people this guest answers for
 * told us at RSVP about food and getting around.
 *
 * `actsFor` bounds whose needs are read: a guest sees the planner shaped by their own answers and
 * by those of the people they RSVP for, never by another adult's private note.
 */
export async function tripRecordsFor(db: Db, args: { guestId: GuestId; householdId: HouseholdId; actsFor: readonly string[] }): Promise<TripRecords> {
  const members = (await listHouseholdMembers(db, args.householdId)).filter((m) => !m.mergedIntoGuestId);
  const ids = members.map((m) => m.id);
  const scope = [...new Set([args.guestId, ...args.actsFor])].filter((id) => ids.includes(id));
  const [responses, needs] = await Promise.all([
    ids.length ? db.select({ guestId: rsvpResponses.guestId, status: rsvpResponses.status, plusOne: rsvpResponses.plusOneAttending }).from(rsvpResponses).where(inArray(rsvpResponses.guestId, ids)) : [],
    scope.length ? db.select().from(guestNeeds).where(inArray(guestNeeds.guestId, scope)) : [],
  ]);
  // Someone who has answered every invitation with a no is not travelling. No answer yet counts as coming.
  const declinedAll = (id: string) => {
    const mine = responses.filter((r) => r.guestId === id);
    return mine.length > 0 && mine.every((r) => r.status === 'declined');
  };
  let adults = 0;
  let children = 0;
  for (const m of members) {
    if (declinedAll(m.id)) continue;
    // A plus-one with no name yet travels only once the guest has said they are bringing one.
    if (m.kind === 'plus_one' && !m.isNamed && !responses.some((r) => r.guestId === m.plusOneOfGuestId && r.plusOne)) continue;
    if (m.kind === 'child' || m.isMinor) children += 1;
    else adults += 1;
  }
  const join = (key: 'dietary' | 'accessibility') => needs.map((n) => n[key]?.trim()).filter(Boolean).join('. ') || null;
  return { adults: Math.max(1, adults), children, dietary: join('dietary'), accessibility: join('accessibility') };
}
