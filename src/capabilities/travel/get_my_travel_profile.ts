import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { AIRPORTS, BRIEF_CITATION, getInvitationLocationSuggestion, getTravelProfile, locationSuggestion, travelProfileOutput, ulid } from '@/domain/travel';
import { airportOutput, resolveGuestTarget, travelServices } from './_shared';

const input = z.object({ guestId: ulid.optional() }).optional();
const output = z.object({
  guestId: z.string(),
  optedIn: z.boolean(),
  profile: travelProfileOutput.nullable(),
  /** From the invitation only, and only until the guest saves a profile. Never inferred from IP. */
  suggestion: locationSuggestion.nullable(),
  airports: z.array(airportOutput),
});

export const getMyTravelProfile = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'get_my_travel_profile',
  title: 'My travel profile',
  description:
    'Returns the signed-in guest’s opt-in travel preferences (home city, preferred airports, travellers, airline/nonstop/cabin preferences, arrival and departure windows) ' +
    'or null when they have not saved one, plus the two Chicago airports. Household managers may pass a household member’s guestId. It reads only.',
  kind: 'read',
  auth: 'guest',
  requires: ['view_travel_tools'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 4_000,
  async handler(ctx, i) {
    const target = resolveGuestTarget(ctx, i?.guestId);
    if (!target.ok) return err(target.error);
    const { db } = travelServices(ctx);
    const profile = await getTravelProfile(db, target.value.guestId);
    const suggestion = profile ? null : await getInvitationLocationSuggestion(db, target.value.guestId);
    return ok({ data: { guestId: target.value.guestId, optedIn: profile !== null, profile, suggestion, airports: AIRPORTS.map((a) => ({ ...a })) }, sources: [BRIEF_CITATION] });
  },
});
