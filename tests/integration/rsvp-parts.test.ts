import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminSetMealOptions, adminSetRsvpWindow, draftRsvp, getMyItinerary, getMyRsvp, submitRsvp } from '@/capabilities/rsvp';
import type { Db } from '@/db/client';
import { rsvpResponses } from '@/db/schema';
import { FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * The staged release, end to end through the real pipeline: attendance opens alone, then meals,
 * then plus-ones, then the menu changes. At every step a guest answers only what is new, and
 * nothing they answered before moves.
 *
 * C1 (Fin) is invited to the ceremony and the reception; the reception has a meal and an unnamed
 * plus-one — every part applies to them.
 */
const C1 = fixturePrincipal('C1');
const admin = fixtureAdmin();
const E = FX.events;
let db: Db;

const part = (data: { parts: Array<{ part: string }> }, name: string) => data.parts.find((p) => p.part === name);

async function answer(input: Record<string, unknown>) {
  const draft = expectOk(await run(draftRsvp, C1, input));
  return expectOk(await run(submitRsvp, C1, draft.data.submission, { confirmationToken: draft.confirmation!.token }));
}

const reception = async () => (await db.select().from(rsvpResponses).where(and(eq(rsvpResponses.guestId, FX.guestC1), eq(rsvpResponses.eventId, E.reception))))[0]!;

beforeAll(async () => {
  db = await seedSwarmE();
  expectOk(await run(adminSetRsvpWindow, admin, { mode: 'open', deadlineAt: null }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('each part of the RSVP opens on its own', () => {
  it('with only attendance released: asks attendance, says plus-ones and meals open later, and refuses a meal', async () => {
    vi.stubEnv('FLAG_RSVP_PLUS_ONES', 'off');
    vi.stubEnv('FLAG_RSVP_MEALS', 'off');
    const mine = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(mine, 'attendance')).toMatchObject({ state: 'open', status: 'not_started' });
    expect(part(mine, 'plusOne')).toMatchObject({ state: 'later', reason: 'not_released' });
    expect(part(mine, 'meal')).toMatchObject({ state: 'later', reason: 'not_released' });
    expect(mine.next).toEqual(['attendance', 'notes']);

    // Naming a part that is not open is a conflict, never a silent drop.
    const early = expectErr(await run(draftRsvp, C1, { parts: ['meal'], responses: [{ guestId: FX.guestC1, eventId: E.reception, mealOptionId: FX.mealBeef }] }));
    expect(early).toMatchObject({ code: 'conflict', details: { reason: 'part_not_open', parts: ['meal'] } });

    // Attending an event with a meal no longer demands the meal while meals are not released.
    const done = await answer({
      responses: [
        { guestId: FX.guestC1, eventId: E.ceremony, status: 'accepted' },
        { guestId: FX.guestC1, eventId: E.reception, status: 'accepted', mealOptionId: FX.mealBeef, plusOne: { attending: true, name: 'Should not be saved' } },
      ],
    });
    expect(done.data.lines).toHaveLength(2);
    expect(await reception()).toMatchObject({ status: 'accepted', mealOptionId: null, plusOneAttending: false, plusOneName: null, plusOneAnsweredAt: null });

    const after = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(after, 'attendance')).toMatchObject({ status: 'done' });
    expect(after.next).toEqual([]);
  });

  it('when meals open: asks the meal alone, from the attendance on file, and leaves attendance untouched', async () => {
    vi.stubEnv('FLAG_RSVP_PLUS_ONES', 'off');
    const mine = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(mine, 'meal')).toMatchObject({ state: 'open', status: 'not_started', expected: 1 });
    expect(mine.next).toEqual(['meal']);
    const weekend = expectOk(await run(getMyItinerary, C1, {})).data;
    expect(weekend.rsvp.next).toEqual(['meal']);

    const before = await reception();
    // A status sent with a meal-only answer is ignored: attendance comes from the file.
    await answer({ parts: ['meal'], responses: [{ guestId: FX.guestC1, eventId: E.reception, status: 'declined', mealOptionId: FX.mealFish }] });
    const row = await reception();
    expect(row).toMatchObject({ status: 'accepted', mealOptionId: FX.mealFish, mealOptionsVersion: 1 });
    expect(row.version).toBe(before.version + 1);
    expect(part(expectOk(await run(getMyRsvp, C1, {})).data, 'meal')).toMatchObject({ status: 'done' });
  });

  it('when plus-ones open: asks the plus-one alone, keeps the meal, and then asks the new guest\'s meal', async () => {
    const mine = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(mine, 'plusOne')).toMatchObject({ state: 'open', status: 'not_started', expected: 1 });
    expect(mine.next).toEqual(['plusOne']);

    await answer({ parts: ['plusOne'], responses: [{ guestId: FX.guestC1, eventId: E.reception, plusOne: { attending: true, name: null } }] });
    const row = await reception();
    expect(row).toMatchObject({ status: 'accepted', mealOptionId: FX.mealFish, plusOneAttending: true, plusOneName: null });
    expect(row.plusOneAnsweredAt).toBeInstanceOf(Date);

    const now = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(now, 'plusOne')).toMatchObject({ status: 'done' });
    expect(part(now, 'meal')).toMatchObject({ status: 'in_progress', expected: 2, answered: 1 });
    expect(now.next).toEqual(['meal']);

    await answer({ parts: ['meal'], responses: [{ guestId: FX.guestC1, eventId: E.reception, mealOptionId: FX.mealFish, plusOne: { attending: false, mealOptionId: FX.mealGarden } }] });
    // The unchecked plus-one box on a meals page is not a "no".
    expect(await reception()).toMatchObject({ plusOneAttending: true, plusOneMealOptionId: FX.mealGarden });
  });

  it('a new menu marks the meals stale, and an attendance-only answer does not quietly make them current', async () => {
    expectOk(await run(adminSetMealOptions, admin, { eventId: E.reception, options: [{ label: 'Menu two, first' }, { label: 'Menu two, second' }] }));
    const stale = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(part(stale, 'meal')).toMatchObject({ status: 'needs_attention', attention: 2 });

    await answer({ parts: ['attendance'], responses: [{ guestId: FX.guestC1, eventId: E.reception, status: 'accepted' }] });
    const row = await reception();
    expect(row).toMatchObject({ mealOptionId: FX.mealFish, mealOptionsVersion: 1, plusOneAttending: true });
    expect(part(expectOk(await run(getMyRsvp, C1, {})).data, 'meal')).toMatchObject({ status: 'needs_attention' });
  });

  it('submit re-reads the parts it is not answering, so a stale draft cannot overwrite a newer answer', async () => {
    const draft = expectOk(await run(draftRsvp, C1, { parts: ['notes'], responses: [], needs: [{ guestId: FX.guestC1, dietary: null, accessibility: 'Step-free route, please' }] }));
    // Someone else in the household changes attendance between the draft and the confirmation.
    await answer({ parts: ['attendance'], responses: [{ guestId: FX.guestC1, eventId: E.reception, status: 'declined' }] });
    expectOk(await run(submitRsvp, C1, draft.data.submission, { confirmationToken: draft.confirmation!.token }));
    expect(await reception()).toMatchObject({ status: 'declined', mealOptionId: null, plusOneAttending: false });
    expect(part(expectOk(await run(getMyRsvp, C1, {})).data, 'notes')).toMatchObject({ status: 'done' });
  });

  it('with every part switched off, nothing can be drafted and the guest is told replies are not open', async () => {
    for (const f of ['FLAG_RSVP_ATTENDANCE', 'FLAG_RSVP_PLUS_ONES', 'FLAG_RSVP_MEALS']) vi.stubEnv(f, 'off');
    const mine = expectOk(await run(getMyRsvp, C1, {})).data;
    expect(mine.parts.every((p) => p.state !== 'open')).toBe(true);
    expect(mine.next).toEqual([]);
    expect(expectErr(await run(draftRsvp, C1, { responses: [{ guestId: FX.guestC1, eventId: E.ceremony, status: 'accepted' }] }))).toMatchObject({ code: 'conflict', details: { reason: 'part_not_open' } });
  });
});
