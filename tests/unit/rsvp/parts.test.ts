import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, readFlags, type FlagValues } from '@/contracts/flags';
import { computeRsvpWindow } from '@/domain/events/window';
import { nextParts, rsvpProgress, type ProgressInput, type RsvpPart } from '@/domain/rsvp/parts';
import type { RsvpOnFile, RsvpValidationContext } from '@/domain/rsvp/types';
import { validateHouseholdRsvp } from '@/domain/rsvp/validate';

/**
 * The parts of an RSVP ship independently. Two properties carry that, and both are tested here:
 * each part's state is decided by its own release flag AND its own data, and a submission writes
 * only the parts it names — everything else is carried over from the file, unjudged.
 */

/** Every part released, as the tests below reason about it; the shipped default is pinned separately. */
const flags = (over: Partial<FlagValues> = {}): FlagValues => ({ ...FEATURE_FLAGS, RSVP_MEALS: true, ...over });
const byPart = (p: ReturnType<typeof rsvpProgress>) => Object.fromEntries(p.map((x) => [x.part, x])) as Record<RsvpPart, (typeof p)[number]>;

const events = [
  { id: 'E-CER', hasMeal: false, mealOptionsVersion: 0, rsvpRequired: true },
  { id: 'E-REC', hasMeal: true, mealOptionsVersion: 2, rsvpRequired: true },
];
const mealOptions = [
  { id: 'M-OLD', eventId: 'E-REC', version: 1 },
  { id: 'M-BEEF', eventId: 'E-REC', version: 2 },
  { id: 'M-VEG', eventId: 'E-REC', version: 2 },
];
const entitlements = [
  { guestId: 'G1', eventId: 'E-CER', plusOnePolicy: 'none' as const },
  { guestId: 'G1', eventId: 'E-REC', plusOnePolicy: 'named' as const },
  { guestId: 'G2', eventId: 'E-REC', plusOnePolicy: 'none' as const },
];
const row = (guestId: string, eventId: string, over: Partial<ProgressInput['responses'][number]> = {}): ProgressInput['responses'][number] => ({
  guestId,
  eventId,
  status: 'accepted',
  mealOptionId: null,
  mealOptionsVersion: null,
  plusOneAttending: false,
  plusOneMealOptionId: null,
  plusOneAnsweredAt: null,
  ...over,
});
const base: ProgressInput = { entitlements, events, mealOptions, responses: [], needs: [] };

describe('the shipped release', () => {
  it('holds meals shut until the menu is set, and tells guests that is why', () => {
    expect(readFlags({}).RSVP_MEALS).toBe(false);
    expect(readFlags({ FLAG_RSVP_MEALS: 'on' }).RSVP_MEALS).toBe(true);
    const shipped = byPart(rsvpProgress(readFlags({}), { ...base, mealOptions: [] }));
    expect(shipped.attendance.state).toBe('open');
    expect(shipped.meal).toMatchObject({ state: 'later', reason: 'menu_pending' });
    expect(nextParts(rsvpProgress(readFlags({}), { ...base, mealOptions: [] }))).not.toContain('meal');
  });
});

describe('rsvpProgress: each part is released by its own flag and its own data', () => {
  it('holds a part shut when its flag is off, and says which wait it is', () => {
    const p = byPart(rsvpProgress(flags({ RSVP_PLUS_ONES: false, RSVP_MEALS: false }), base));
    expect(p.attendance).toMatchObject({ state: 'open', status: 'not_started', expected: 3 });
    expect(p.plusOne).toMatchObject({ state: 'later', reason: 'not_released', status: 'later' });
    expect(p.meal).toMatchObject({ state: 'later', reason: 'not_released', status: 'later' });
    expect(p.notes).toMatchObject({ state: 'open', status: 'optional' });
  });

  it('holds meals shut until a menu is published for the current version, whatever the flag says', () => {
    const noMenu = byPart(rsvpProgress(flags(), { ...base, mealOptions: mealOptions.filter((m) => m.version === 1) }));
    expect(noMenu.meal).toMatchObject({ state: 'later', reason: 'menu_pending' });
  });

  it('leaves off parts the invitation does not include, rather than promising them later', () => {
    const p = byPart(rsvpProgress(flags(), { ...base, entitlements: entitlements.map((e) => ({ ...e, plusOnePolicy: 'none' as const })), events: events.map((e) => ({ ...e, hasMeal: false })) }));
    // `status` too: an assistant reading it alone must not say plus-ones "open later".
    expect(p.plusOne).toMatchObject({ state: 'not_applicable', status: 'not_applicable', reason: null });
    expect(p.meal).toMatchObject({ state: 'not_applicable', status: 'not_applicable', reason: null });
    const nothing = byPart(rsvpProgress(flags({ RSVP_ATTENDANCE: false }), { ...base, entitlements: [] }));
    expect(nothing.attendance).toMatchObject({ state: 'not_applicable', status: 'not_applicable', reason: null });
  });

  it('waits on attendance, then counts only the people who are coming', () => {
    expect(byPart(rsvpProgress(flags(), base)).meal.status).toBe('waiting');
    const p = byPart(rsvpProgress(flags(), { ...base, responses: [row('G1', 'E-CER'), row('G1', 'E-REC', { mealOptionId: 'M-BEEF', mealOptionsVersion: 2 }), row('G2', 'E-REC', { status: 'declined' })] }));
    expect(p.attendance).toMatchObject({ status: 'done', answered: 3 });
    expect(p.meal).toMatchObject({ status: 'done', expected: 1, answered: 1 });
    expect(p.plusOne).toMatchObject({ status: 'not_started', expected: 1, answered: 0 });
  });

  it('says "not needed" once attendance is complete and nobody it applies to is coming', () => {
    const p = byPart(rsvpProgress(flags(), { ...base, responses: [row('G1', 'E-CER', { status: 'declined' }), row('G1', 'E-REC', { status: 'declined' }), row('G2', 'E-REC', { status: 'declined' })] }));
    expect(p.meal.status).toBe('not_needed');
    expect(p.plusOne.status).toBe('not_needed');
  });

  it('counts a plus-one who is coming as a meal to choose, and a meal from an old menu as needing attention', () => {
    const p = byPart(
      rsvpProgress(flags(), {
        ...base,
        responses: [row('G1', 'E-REC', { mealOptionId: 'M-OLD', mealOptionsVersion: 1, plusOneAttending: true, plusOneAnsweredAt: new Date() })],
      }),
    );
    expect(p.meal).toMatchObject({ status: 'needs_attention', expected: 2, answered: 0, attention: 1 });
    expect(p.plusOne).toMatchObject({ status: 'done' });
  });
});

describe('nextParts: one form for everything still open', () => {
  it('asks everything together on a first reply, so a fully released RSVP is still one form', () => {
    expect(nextParts(rsvpProgress(flags(), base))).toEqual(['attendance', 'plusOne', 'meal', 'notes']);
  });
  it('asks only the newly released part once attendance is done', () => {
    const answered = { ...base, responses: [row('G1', 'E-CER'), row('G1', 'E-REC', { plusOneAnsweredAt: new Date() }), row('G2', 'E-REC', { status: 'declined' })] };
    expect(nextParts(rsvpProgress(flags({ RSVP_MEALS: false }), answered))).toEqual([]);
    expect(nextParts(rsvpProgress(flags(), answered))).toEqual(['meal']);
  });
});

describe('validateHouseholdRsvp with parts: write only what was answered', () => {
  const ctx = (parts: RsvpPart[], onFile: Record<string, RsvpOnFile> = {}): RsvpValidationContext => ({
    actsFor: new Set(['G1', 'G2']),
    entitlements,
    events,
    mealOptions,
    window: computeRsvpWindow({ mode: 'open', deadlineAt: null }, 'TEASER', new Date()),
    mode: 'guest',
    parts: new Set(parts),
    onFile: new Map(Object.entries(onFile)),
  });
  const accepted = { status: 'accepted' as const, mealOptionId: null, plusOne: null };

  it('accepts attendance at an event with a meal without asking for the meal when meals are not being answered', () => {
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', ...accepted }], needs: [] }, ctx(['attendance']));
    expect(r).toMatchObject({ ok: true, value: { responses: [{ status: 'accepted', mealOptionId: null }] } });
  });

  it('keeps a meal on file when only attendance is answered, and drops it on a decline', () => {
    const onFile = { 'G2::E-REC': { status: 'accepted' as const, mealOptionId: 'M-OLD', plusOne: null } };
    const kept = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', ...accepted, mealOptionId: 'M-BEEF' }], needs: [] }, ctx(['attendance'], onFile));
    // Carried as-is — even a stale choice: it is not this submission's to judge, and the page says "choose again" elsewhere.
    expect(kept.ok && kept.value.responses[0]?.mealOptionId).toBe('M-OLD');
    const declined = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', status: 'declined', mealOptionId: null, plusOne: null }], needs: [] }, ctx(['attendance'], onFile));
    expect(declined.ok && declined.value.responses[0]).toMatchObject({ status: 'declined', mealOptionId: null, plusOne: null });
  });

  it('answers a meal on its own from the attendance on file, and refuses one for somebody not yet answered', () => {
    const onFile = { 'G2::E-REC': { status: 'accepted' as const, mealOptionId: null, plusOne: null } };
    const ok = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', status: null, mealOptionId: 'M-VEG', plusOne: null }], needs: [] }, ctx(['meal'], onFile));
    expect(ok).toMatchObject({ ok: true, value: { responses: [{ status: 'accepted', mealOptionId: 'M-VEG' }] } });
    const missing = validateHouseholdRsvp({ responses: [{ guestId: 'G1', eventId: 'E-REC', status: null, mealOptionId: 'M-VEG', plusOne: null }], needs: [] }, ctx(['meal'], onFile));
    expect(missing).toMatchObject({ ok: false, kind: 'validation', issues: [{ path: 'responses.0.status', message: 'Please tell us whether they are coming first.' }] });
  });

  it('ignores a status sent with a meal-only answer: attendance comes from the file', () => {
    const onFile = { 'G2::E-REC': { status: 'accepted' as const, mealOptionId: null, plusOne: null } };
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', status: 'declined', mealOptionId: 'M-VEG', plusOne: null }], needs: [] }, ctx(['meal'], onFile));
    expect(r.ok && r.value.responses[0]).toMatchObject({ status: 'accepted', mealOptionId: 'M-VEG' });
  });

  it('splits the plus-one: who they are with the plus-one part, what they eat with the meal part', () => {
    const onFile = { 'G1::E-REC': { status: 'accepted' as const, mealOptionId: 'M-BEEF', plusOne: { attending: true, name: 'Robin', mealOptionId: 'M-VEG' } } };
    const renamed = validateHouseholdRsvp({ responses: [{ guestId: 'G1', eventId: 'E-REC', status: null, mealOptionId: null, plusOne: { attending: true, name: 'Robin Q', mealOptionId: null } }], needs: [] }, ctx(['plusOne'], onFile));
    expect(renamed.ok && renamed.value.responses[0]).toMatchObject({ mealOptionId: 'M-BEEF', plusOne: { attending: true, name: 'Robin Q', mealOptionId: 'M-VEG' }, plusOneAnswered: true });
    const fed = validateHouseholdRsvp({ responses: [{ guestId: 'G1', eventId: 'E-REC', status: null, mealOptionId: 'M-BEEF', plusOne: { attending: false, name: null, mealOptionId: 'M-BEEF' } }], needs: [] }, ctx(['meal'], onFile));
    // The unchecked box on a meals page is not a "no": the plus-one is still coming, now with a meal.
    expect(fed.ok && fed.value.responses[0]).toMatchObject({ plusOne: { attending: true, name: 'Robin', mealOptionId: 'M-BEEF' }, plusOneAnswered: false });
  });

  it('keeps a plus-one on file that an answer leaves out — and so still asks for their meal', () => {
    const onFile = { 'G1::E-REC': { status: 'accepted' as const, mealOptionId: 'M-BEEF', plusOne: { attending: true, name: 'Robin', mealOptionId: 'M-VEG' } } };
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G1', eventId: 'E-REC', ...accepted, mealOptionId: 'M-BEEF' }], needs: [] }, ctx(['attendance', 'plusOne', 'meal'], onFile));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.issues).toEqual([expect.objectContaining({ path: 'responses.0.plusOne.mealOptionId' })]);
  });

  it('writes notes only when notes are answered', () => {
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', ...accepted }], needs: [{ guestId: 'G2', dietary: 'x', accessibility: null }] }, ctx(['attendance']));
    expect(r.ok && r.value.needs).toEqual([]);
    const notesOnly = validateHouseholdRsvp({ responses: [], needs: [{ guestId: 'G2', dietary: 'x', accessibility: null }] }, ctx(['notes']));
    expect(notesOnly.ok && notesOnly.value.needs).toEqual([{ guestId: 'G2', dietary: 'x', accessibility: null }]);
  });

  it('keeps a meal on file when meals are answered but this event has no menu for its current version', () => {
    const onFile = { 'G2::E-REC': { status: 'accepted' as const, mealOptionId: 'M-OLD', plusOne: null } };
    const noCurrentMenu = { ...ctx(['meal'], onFile), mealOptions: mealOptions.filter((m) => m.version === 1) };
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', status: null, mealOptionId: null, plusOne: null }], needs: [] }, noCurrentMenu);
    // Nothing was asked about it, so it is not wiped — and it is not marked as chosen now, so it
    // keeps the version it was chosen from and still reads "the menu changed" once one exists.
    expect(r.ok && r.value.responses[0]).toMatchObject({ mealOptionId: 'M-OLD', mealAnswered: false });
  });

  it('lets an admin correction remove a plus-one by sending none', () => {
    const onFile = { 'G1::E-REC': { status: 'accepted' as const, mealOptionId: 'M-BEEF', plusOne: { attending: true, name: 'Robin', mealOptionId: 'M-VEG' } } };
    const admin = { ...ctx(['attendance', 'plusOne', 'meal', 'notes'], onFile), mode: 'admin' as const };
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G1', eventId: 'E-REC', status: 'accepted', mealOptionId: 'M-BEEF', plusOne: null }], needs: [] }, admin);
    expect(r.ok && r.value.responses[0]).toMatchObject({ plusOne: { attending: false, name: null, mealOptionId: null }, plusOneAnswered: true });
  });

  it('does not demand a meal for an event whose menu is not published yet', () => {
    const r = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', ...accepted }], needs: [] }, { ...ctx(['attendance', 'meal']), mealOptions: [] });
    expect(r.ok).toBe(true);
    const offered = validateHouseholdRsvp({ responses: [{ guestId: 'G2', eventId: 'E-REC', ...accepted, mealOptionId: 'M-BEEF' }], needs: [] }, { ...ctx(['attendance', 'meal']), mealOptions: [] });
    expect(!offered.ok && offered.issues[0]?.message).toBe('The menu for this event is not ready yet.');
  });
});
