import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { getTripPreferences, saveTripPreferences, tripRecordsFor } from '@/domain/travel';
import { profileOf } from '@/domain/trip-planner/profile';
import { requireGuestWriter, travelServices } from './_shared';
import { tripPrefsSchema, tripProfileSchema } from './trip_profile_schemas';

const input = z.object({
  prefs: tripPrefsSchema,
  /**
   * The `updatedAt` this change was made from, when the page has one. Saved preferences that are
   * newer than that were changed on another device since: they are returned, not overwritten.
   */
  basedOn: z.string().nullable().optional(),
});
const output = z.object({ profile: tripProfileSchema, prefs: tripPrefsSchema.nullable(), updatedAt: z.string().nullable(), conflict: z.boolean() });

/**
 * Saves what the guest set for the trip planner (what they eat, what they would spend, how far they
 * walk, what they enjoy). Saving an empty set clears them. Website only, like the profile it shapes.
 */
export const saveMyTripPreferences = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'save_my_trip_preferences',
  title: 'Save my trip preferences',
  description:
    'Saves what the signed-in guest set for the trip planner: what they eat, the kind of meal and price they like, step-free places only, staying close to the hotel, whether children come along, and interests. ' +
    'Replaces what was saved before; an empty set clears it. Website only.',
  kind: 'action',
  auth: 'guest',
  // About the caller's own guest identity: an admin clears the `guest` floor but has none.
  guestIdentityRequired: true,
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  // The result says what the RSVP's notes on food and access mean for this guest. Like those notes,
  // it is never stored against the key (docs/architecture/rsvp-seating.md): a repeat saves again.
  replayable: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 2_000,
  async handler(ctx, i) {
    const who = requireGuestWriter(ctx);
    if (!who.ok) return err(who.error);
    const { db } = travelServices(ctx);
    const { guestId, householdId, principal } = who.value;
    const [records, before] = await Promise.all([tripRecordsFor(db, { guestId, householdId, actsFor: principal.actsFor }), getTripPreferences(db, guestId)]);
    // Changed somewhere else since this page read it: hand back what is saved, so the page shows it.
    if (i.basedOn !== undefined && before && before.updatedAt !== i.basedOn && new Date(before.updatedAt) > new Date(i.basedOn ?? 0)) {
      return ok({ data: { profile: profileOf(records, before.prefs), prefs: before.prefs, updatedAt: before.updatedAt, conflict: true }, sources: [] });
    }
    const saved = await saveTripPreferences(db, { guestId, householdId, prefs: i.prefs, now: ctx.now });
    return ok({ data: { profile: profileOf(records, saved?.prefs ?? null), prefs: saved?.prefs ?? null, updatedAt: saved?.updatedAt ?? null, conflict: false }, sources: [] });
  },
});
