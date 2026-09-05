import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { GuestPrincipal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { loadHouseholdRsvpContext, type HouseholdRsvpContext } from '@/domain/rsvp';
import { validateHouseholdRsvp, type HouseholdRsvpInput, type RsvpValidation, type RsvpValidationContext } from '@/domain/rsvp';
import { RSVP_CLOSED_MESSAGE } from '@/domain/rsvp/validate';

/** Loads the household context scoped to the principal's actsFor set. Nothing outside it is ever read. */
export async function loadForPrincipal(ctx: CapabilityContext, p: GuestPrincipal): Promise<HouseholdRsvpContext> {
  const { db } = appServices(ctx);
  const scope = p.actsFor.includes(p.guestId) ? p.actsFor : [p.guestId, ...p.actsFor];
  return loadHouseholdRsvpContext(db, { guestIds: scope, householdId: p.householdId, now: ctx.now });
}

export function validationContext(hc: HouseholdRsvpContext, actsFor: readonly string[], mode: 'guest' | 'admin'): RsvpValidationContext {
  return {
    actsFor: new Set(actsFor),
    entitlements: hc.entitlements.map((e) => ({ guestId: e.guestId, eventId: e.eventId, plusOnePolicy: e.plusOnePolicy })),
    events: hc.entitledEvents.map((e) => ({ id: e.id, hasMeal: e.hasMeal, mealOptionsVersion: e.mealOptionsVersion, rsvpRequired: e.rsvpRequired })),
    mealOptions: hc.mealOptions.map((m) => ({ id: m.id, eventId: m.eventId, version: m.version })),
    window: hc.window,
    mode,
  };
}

/** Maps a domain validation result to the capability error vocabulary. */
export function toCapabilityResult(v: RsvpValidation): Result<HouseholdRsvpInput, CapabilityError> {
  if (v.ok) return ok(v.value);
  if (v.kind === 'forbidden') return err(new CapabilityError('forbidden', v.issues[0]?.message ?? 'You can only RSVP for your own household.', { issues: v.issues }));
  if (v.kind === 'closed') return err(new CapabilityError('conflict', RSVP_CLOSED_MESSAGE, { reason: 'rsvp_closed', issues: v.issues }));
  return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: v.issues }));
}

export const validateFor = (hc: HouseholdRsvpContext, actsFor: readonly string[], mode: 'guest' | 'admin', input: HouseholdRsvpInput) =>
  toCapabilityResult(validateHouseholdRsvp(input, validationContext(hc, actsFor, mode)));

export function namesFor(hc: HouseholdRsvpContext) {
  const guestName = new Map(hc.guests.map((g) => [g.id, g.displayName]));
  const eventName = new Map(hc.events.map((e) => [e.id, e.name]));
  const mealLabel = new Map(hc.mealOptions.map((m) => [m.id, m.label]));
  return {
    guestName: (id: string) => guestName.get(id) ?? 'Guest',
    eventName: (id: string) => eventName.get(id) ?? 'Event',
    mealLabel: (id: string | null) => (id ? (mealLabel.get(id) ?? null) : null),
  };
}
