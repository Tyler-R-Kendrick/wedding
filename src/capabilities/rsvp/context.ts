import { guestDisplayName } from '@/domain/guests/repo';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { GuestPrincipal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { err, ok } from '@/contracts/result';
import { eDb } from './db';
import type { FlagValues } from '@/contracts/flags';
import { liveParts, loadHouseholdRsvpContext, onFileMap, orderParts, rsvpProgress, type HouseholdRsvpContext, type PartProgress, type RsvpPart } from '@/domain/rsvp';
import { validateHouseholdRsvp, type HouseholdRsvpDraft, type HouseholdRsvpInput, type RsvpValidation, type RsvpValidationContext } from '@/domain/rsvp';
import { RSVP_CLOSED_MESSAGE } from '@/domain/rsvp/validate';

/** Loads the household context scoped to the principal's actsFor set. Nothing outside it is ever read. */
export async function loadForPrincipal(ctx: CapabilityContext, p: GuestPrincipal): Promise<HouseholdRsvpContext> {
  const db = await eDb(ctx);
  const scope = p.actsFor.includes(p.guestId) ? p.actsFor : [p.guestId, ...p.actsFor];
  return loadHouseholdRsvpContext(db, { guestIds: scope, householdId: p.householdId, now: ctx.now });
}

export function validationContext(hc: HouseholdRsvpContext, actsFor: readonly string[], mode: 'guest' | 'admin', parts?: ReadonlySet<RsvpPart>): RsvpValidationContext {
  return {
    parts,
    onFile: onFileMap(hc.responses),
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

export const validateFor = (hc: HouseholdRsvpContext, actsFor: readonly string[], mode: 'guest' | 'admin', input: HouseholdRsvpDraft, parts?: ReadonlySet<RsvpPart>) =>
  toCapabilityResult(validateHouseholdRsvp(input, validationContext(hc, actsFor, mode, parts)));

const progressInput = (hc: HouseholdRsvpContext) => ({ entitlements: hc.entitlements, events: hc.entitledEvents, mealOptions: hc.mealOptions, responses: hc.responses, needs: hc.needs });

/** Per-part state and progress for the household the context was loaded for. */
export const progressFor = (flags: FlagValues, hc: HouseholdRsvpContext): PartProgress[] => rsvpProgress(flags, progressInput(hc));

const NOT_OPEN: Record<RsvpPart, string> = {
  attendance: 'Replies are not open yet.',
  plusOne: 'Plus-ones are not open yet.',
  meal: 'Meal choices are not open yet.',
  notes: 'Notes are not open yet.',
};

/**
 * The parts a guest submission answers: the ones asked for, or — when none are named — every part
 * open right now. Asking for a part that is not open is a `conflict` (like a closed window), never a
 * silent drop: a guest who chose a meal must not be told "you are all set" when nothing was saved.
 */
export function resolveParts(flags: FlagValues, hc: HouseholdRsvpContext, requested: readonly RsvpPart[] | undefined): Result<Set<RsvpPart>, CapabilityError> {
  const live = liveParts(flags, progressInput(hc));
  if (!requested) {
    if (live.size === 0) return err(new CapabilityError('conflict', NOT_OPEN.attendance, { reason: 'part_not_open', parts: [] }));
    return ok(live);
  }
  const closed = orderParts(requested.filter((p) => !live.has(p)));
  if (closed.length) {
    return err(new CapabilityError('conflict', NOT_OPEN[closed[0]!], { reason: 'part_not_open', parts: closed, issues: closed.map((p) => ({ path: 'parts', message: NOT_OPEN[p] })) }));
  }
  return ok(new Set(requested));
}

export function namesFor(hc: HouseholdRsvpContext) {
  const guestName = new Map(hc.guests.map((g) => [g.id, guestDisplayName(g)]));
  const eventName = new Map(hc.events.map((e) => [e.id, e.name]));
  const mealLabel = new Map(hc.mealOptions.map((m) => [m.id, m.label]));
  return {
    guestName: (id: string) => guestName.get(id) ?? 'Guest',
    eventName: (id: string) => eventName.get(id) ?? 'Event',
    mealLabel: (id: string | null) => (id ? (mealLabel.get(id) ?? null) : null),
  };
}
