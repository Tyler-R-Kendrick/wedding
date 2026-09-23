import type { FeatureFlag, FlagValues } from '@/contracts/flags';
import type { EventEntitlementRow, EventRow, GuestNeedsRow, MealOptionRow, RsvpResponseRow } from '@/db/schema';

/**
 * The parts of an RSVP, each released on its own (docs/architecture/rsvp-seating.md › Parts).
 *
 * A submission names the parts it answers and writes only their fields; everything else on the row
 * is carried over from what is on file. That is what lets meals open a month after attendance
 * without asking anyone to answer attendance again — and lets a guest change who is coming without
 * the form quietly wiping a meal they chose last week.
 */
export const RSVP_PARTS = ['attendance', 'plusOne', 'meal', 'notes'] as const;
export type RsvpPart = (typeof RSVP_PARTS)[number];

/** The release switch for each part. Notes ride with attendance: they are asked of whoever answers. */
export const RSVP_PART_FLAG: Record<RsvpPart, FeatureFlag> = {
  attendance: 'RSVP_ATTENDANCE',
  plusOne: 'RSVP_PLUS_ONES',
  meal: 'RSVP_MEALS',
  notes: 'RSVP_ATTENDANCE',
};

/** Canonical order, so a set of parts hashes the same however it was assembled. */
export function orderParts(parts: Iterable<RsvpPart>): RsvpPart[] {
  const set = new Set(parts);
  return RSVP_PARTS.filter((p) => set.has(p));
}

/** An event asks for a meal only once a menu for its current version exists. */
export function mealsPublished(event: Pick<EventRow, 'id' | 'hasMeal' | 'mealOptionsVersion'>, options: ReadonlyArray<Pick<MealOptionRow, 'eventId' | 'version'>>): boolean {
  return event.hasMeal && options.some((o) => o.eventId === event.id && o.version === event.mealOptionsVersion);
}

/**
 * - `open`: can be answered now.
 * - `later`: part of this invitation, not released yet (`reason` says whether it is the release
 *   switch or the menu that holds it).
 * - `not_applicable`: never part of this invitation — no plus-one on it, no event with a meal. Not
 *   shown at all: telling a guest "plus-ones open later" when they have none is a promise the
 *   invitation does not make.
 */
export type PartState = 'open' | 'later' | 'not_applicable';
export type PartLaterReason = 'not_released' | 'menu_pending';

/**
 * What a guest sees next to the part.
 * - `waiting`: open, but nothing to answer until someone says they are coming.
 * - `not_needed`: open, attendance is complete, and nobody it applies to is coming.
 * - `optional`: notes — never required, `done` once any are on file.
 */
export type PartStatus = 'not_started' | 'in_progress' | 'done' | 'needs_attention' | 'waiting' | 'not_needed' | 'optional' | 'later';

export interface PartProgress {
  part: RsvpPart;
  state: PartState;
  reason: PartLaterReason | null;
  status: PartStatus;
  /** Things to answer (guest × event, plus each coming plus-one for meals). */
  expected: number;
  answered: number;
  /** Answers that need doing again: a meal chosen from a menu that has since changed. */
  attention: number;
}

export interface ProgressInput {
  entitlements: ReadonlyArray<Pick<EventEntitlementRow, 'guestId' | 'eventId' | 'plusOnePolicy'>>;
  events: ReadonlyArray<Pick<EventRow, 'id' | 'hasMeal' | 'mealOptionsVersion' | 'rsvpRequired'>>;
  mealOptions: ReadonlyArray<Pick<MealOptionRow, 'id' | 'eventId' | 'version'>>;
  responses: ReadonlyArray<Pick<RsvpResponseRow, 'guestId' | 'eventId' | 'status' | 'mealOptionId' | 'mealOptionsVersion' | 'plusOneAttending' | 'plusOneMealOptionId' | 'plusOneAnsweredAt'>>;
  needs: ReadonlyArray<Pick<GuestNeedsRow, 'guestId' | 'dietary' | 'accessibility'>>;
}

/** Which parts can be answered right now, from the release flags and the data. */
export function liveParts(flags: Pick<FlagValues, FeatureFlag>, input: Pick<ProgressInput, 'events' | 'mealOptions' | 'entitlements'>): Set<RsvpPart> {
  return new Set(rsvpProgress(flags, { ...input, responses: [], needs: [] }).filter((p) => p.state === 'open').map((p) => p.part));
}

/** Per-part state and progress for one household (whatever `input` is scoped to). Pure. */
export function rsvpProgress(flags: Pick<FlagValues, FeatureFlag>, input: ProgressInput): PartProgress[] {
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  const key = (g: string, e: string) => `${g}::${e}`;
  const response = new Map(input.responses.map((r) => [key(r.guestId, r.eventId), r]));
  const expectedPairs = input.entitlements.filter((en) => eventById.get(en.eventId)?.rsvpRequired !== false && eventById.has(en.eventId));
  const accepted = expectedPairs.filter((en) => response.get(key(en.guestId, en.eventId))?.status === 'accepted');
  const attendanceAnswered = expectedPairs.filter((en) => response.has(key(en.guestId, en.eventId))).length;
  const attendanceComplete = expectedPairs.length > 0 && attendanceAnswered === expectedPairs.length;

  const released = (part: RsvpPart) => flags[RSVP_PART_FLAG[part]] === true;
  const statusOf = (p: Omit<PartProgress, 'status'>): PartStatus => {
    if (p.state !== 'open') return 'later';
    if (p.part === 'notes') return p.answered > 0 ? 'done' : 'optional';
    if (p.expected === 0) return attendanceComplete ? 'not_needed' : 'waiting';
    if (p.attention > 0) return 'needs_attention';
    if (p.answered === 0) return 'not_started';
    return p.answered < p.expected ? 'in_progress' : 'done';
  };
  const finish = (p: Omit<PartProgress, 'status'>): PartProgress => ({ ...p, status: statusOf(p) });

  // Attendance
  const attendance = finish({ part: 'attendance', state: expectedPairs.length === 0 ? 'not_applicable' : released('attendance') ? 'open' : 'later', reason: released('attendance') ? null : 'not_released', expected: expectedPairs.length, answered: attendanceAnswered, attention: 0 });

  // Plus-ones: only where the invitation includes one; counted over the rows where someone is coming.
  const withPlusOne = expectedPairs.filter((en) => en.plusOnePolicy !== 'none');
  const plusOneRows = accepted.filter((en) => en.plusOnePolicy !== 'none');
  const plusOne = finish({
    part: 'plusOne',
    state: withPlusOne.length === 0 ? 'not_applicable' : released('plusOne') ? 'open' : 'later',
    reason: withPlusOne.length === 0 || released('plusOne') ? null : 'not_released',
    expected: plusOneRows.length,
    answered: plusOneRows.filter((en) => response.get(key(en.guestId, en.eventId))?.plusOneAnsweredAt).length,
    attention: 0,
  });

  // Meals: every coming guest at an event with a published menu, and every coming plus-one there.
  const mealEvents = input.events.filter((e) => e.hasMeal && expectedPairs.some((en) => en.eventId === e.id));
  const menuReady = mealEvents.some((e) => mealsPublished(e, input.mealOptions));
  let mealExpected = 0;
  let mealAnswered = 0;
  let mealStale = 0;
  for (const en of accepted) {
    const event = eventById.get(en.eventId)!;
    if (!mealsPublished(event, input.mealOptions)) continue;
    const r = response.get(key(en.guestId, en.eventId))!;
    const current = r.mealOptionsVersion === event.mealOptionsVersion;
    mealExpected += 1;
    if (r.mealOptionId && current) mealAnswered += 1;
    else if (r.mealOptionId) mealStale += 1;
    if (r.plusOneAttending) {
      mealExpected += 1;
      if (r.plusOneMealOptionId && current) mealAnswered += 1;
      else if (r.plusOneMealOptionId) mealStale += 1;
    }
  }
  const mealState: PartState = mealEvents.length === 0 ? 'not_applicable' : released('meal') && menuReady ? 'open' : 'later';
  // With no menu yet, that is the reason a guest is given — whether or not meals are also switched
  // off: "opens once the menu is set" is true and tells them what they are waiting for.
  const meal = finish({ part: 'meal', state: mealState, reason: mealState !== 'later' ? null : !menuReady ? 'menu_pending' : 'not_released', expected: mealExpected, answered: mealAnswered, attention: mealStale });

  // Notes: optional, one row per guest.
  const guestIds = new Set(expectedPairs.map((en) => en.guestId));
  const notesOnFile = input.needs.filter((n) => guestIds.has(n.guestId) && (n.dietary || n.accessibility)).length;
  const notes = finish({ part: 'notes', state: expectedPairs.length === 0 ? 'not_applicable' : released('notes') ? 'open' : 'later', reason: released('notes') ? null : 'not_released', expected: guestIds.size, answered: notesOnFile, attention: 0 });

  return [attendance, plusOne, meal, notes];
}

/**
 * The parts /rsvp should ask, in one form, one review and one confirmation: every open part that
 * still wants an answer. While attendance is among them, every other open part comes along too —
 * the same form can turn a "no" into a "yes", and that person's guest and meal belong in the same
 * reply, not in a second pass. That is also what keeps a first reply with everything released
 * exactly as short as it was before the parts were split.
 */
export function nextParts(progress: readonly PartProgress[]): RsvpPart[] {
  const unfinished = (p: PartProgress) => p.state === 'open' && (p.status === 'not_started' || p.status === 'in_progress' || p.status === 'needs_attention');
  const out = new Set(progress.filter(unfinished).map((p) => p.part));
  if (out.has('attendance')) for (const p of progress) if (p.state === 'open') out.add(p.part);
  return orderParts(out);
}
