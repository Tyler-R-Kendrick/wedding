import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { getTripPreferences, tripRecordsFor } from '@/domain/travel';
import { profileOf } from '@/domain/trip-planner/profile';
import { requireGuestWriter, travelServices } from './_shared';
import { tripPrefsSchema, tripProfileSchema } from './trip_profile_schemas';

const input = z.object({}).optional();
const output = z.object({ profile: tripProfileSchema, prefs: tripPrefsSchema.nullable(), updatedAt: z.string().nullable() });
export type MyTripProfile = z.infer<typeof output>;

/**
 * Who the trip planner plans for: the guest's party as the invitation and RSVP have it, with what
 * the guest set for themselves. Website only: it is shaped by RSVP notes on food and access, which
 * never leave the website surface.
 */
export const getMyTripProfile = defineCapability<z.infer<typeof input>, MyTripProfile>({
  name: 'get_my_trip_profile',
  title: 'My trip profile',
  description:
    'Returns who the trip planner plans for: how many adults and children are in the signed-in guest’s party, and what they have said about food, spending, getting around and interests. ' +
    'Built only from the guest’s own invitation, RSVP and saved preferences. Website only.',
  kind: 'read',
  auth: 'guest',
  // About the caller's own guest identity: an admin clears the `guest` floor but has none.
  guestIdentityRequired: true,
  requires: ['view_travel_tools'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 2_000,
  async handler(ctx) {
    const who = requireGuestWriter(ctx);
    if (!who.ok) return err(who.error);
    const { db } = travelServices(ctx);
    const { guestId, householdId, principal } = who.value;
    const [records, saved] = await Promise.all([tripRecordsFor(db, { guestId, householdId, actsFor: principal.actsFor }), getTripPreferences(db, guestId)]);
    return ok({ data: { profile: profileOf(records, saved?.prefs ?? null), prefs: saved?.prefs ?? null, updatedAt: saved?.updatedAt ?? null }, sources: [] });
  },
});
