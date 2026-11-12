import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The planner's server actions against a stand-in for the capability pipeline: a guest's trip items
 * in memory, read and written only through the capabilities the actions name. What is checked is
 * which rows the actions touch, not who may (the capabilities own that).
 */
type Row = { id: string; kind: string; status: string; title: string; startAt: string; endAt: string | null; provider: string | null; details: Record<string, unknown> };

const store = vi.hoisted(() => ({ rows: [] as Row[], next: 1, calls: [] as { cap: string; input: unknown }[], prefs: null as Record<string, unknown> | null, prefsAt: null as string | null, records: { adults: 2, children: 1, dietary: null as string | null, accessibility: null as string | null } }));
const caps = vi.hoisted(() => ({
  getMyTrip: { name: 'get_my_trip' },
  addTripItemCapability: { name: 'add_trip_item' },
  updateTripItemCapability: { name: 'update_trip_item' },
  removeTripItemCapability: { name: 'remove_trip_item' },
  getMyTripProfile: { name: 'get_my_trip_profile' },
  saveMyTripPreferences: { name: 'save_my_trip_preferences' },
  findAdventures: { name: 'find_adventures' },
  listMyEvents: { name: 'list_my_events' },
}));
vi.mock('@/capabilities/travel', () => ({
  getMyTrip: caps.getMyTrip,
  addTripItemCapability: caps.addTripItemCapability,
  updateTripItemCapability: caps.updateTripItemCapability,
  removeTripItemCapability: caps.removeTripItemCapability,
  getMyTripProfile: caps.getMyTripProfile,
  saveMyTripPreferences: caps.saveMyTripPreferences,
}));
vi.mock('@/capabilities/find_adventures', () => ({ findAdventures: caps.findAdventures }));
vi.mock('@/capabilities/rsvp', () => ({ listMyEvents: caps.listMyEvents }));

const ok = <T,>(data: T) => ({ ok: true as const, value: { data, sources: [] } });
const fail = (code: string) => ({ ok: false as const, error: { code, message: code } });
const ulid = (n: number) => `01RWX${String(n).padStart(21, '0')}`;

vi.mock('@/app/(guest)/guests/travel/_shared/server', () => ({
  runAsUi: vi.fn(async (cap: { name: string }, input: never) => {
    store.calls.push({ cap: cap.name, input });
    const i = input as { itemId?: string; item?: Partial<Row>; slug?: string } & Partial<Row>;
    switch (cap.name) {
      case 'find_adventures':
        return ok({ items: i?.slug ? [{ slug: i.slug, title: `Title of ${i.slug}` }] : [] });
      case 'list_my_events':
        return ok({ events: [] });
      case 'get_my_trip_profile': {
        const { profileOf, readPrefs } = await import('@/domain/trip-planner/profile');
        const prefs = store.prefs ? readPrefs(store.prefs) : null;
        return ok({ profile: profileOf(store.records, prefs), prefs, updatedAt: store.prefsAt });
      }
      case 'save_my_trip_preferences': {
        const { profileOf, readPrefs, hasPrefs } = await import('@/domain/trip-planner/profile');
        const sent = input as { prefs: Record<string, unknown>; basedOn?: string | null };
        // Saved (or cleared) somewhere else since the page read it: what is saved comes back, untouched.
        if (sent.basedOn !== undefined && (store.prefsAt ?? null) !== sent.basedOn) {
          const kept = store.prefs ? readPrefs(store.prefs) : null;
          return ok({ profile: profileOf(store.records, kept), prefs: kept, updatedAt: store.prefsAt ?? null, conflict: true });
        }
        const prefs = readPrefs(sent.prefs);
        store.prefs = hasPrefs(prefs) ? prefs : null;
        store.prefsAt = store.prefs ? `2027-07-01T00:00:0${store.next++ % 10}.000Z` : null;
        return ok({ profile: profileOf(store.records, store.prefs ? prefs : null), prefs: store.prefs ? prefs : null, updatedAt: store.prefsAt, conflict: false });
      }
      case 'list_itineraries':
        return ok({ route: '/guests/travel', buckets: [], itineraries: [] });
      case 'get_my_trip':
        return ok({ items: store.rows.map((r) => ({ ...r, details: { ...r.details } })) });
      case 'add_trip_item': {
        const row = { id: ulid(store.next++), status: 'planned', endAt: null, provider: null, details: {}, ...(i as Partial<Row>) } as Row;
        store.rows.push(row);
        return ok(row);
      }
      case 'update_trip_item': {
        const row = store.rows.find((r) => r.id === i.itemId);
        if (!row) return fail('not_found');
        Object.assign(row, i.item);
        return ok(row);
      }
      case 'remove_trip_item': {
        const at = store.rows.findIndex((r) => r.id === i.itemId);
        if (at < 0) return fail('not_found');
        store.rows.splice(at, 1);
        return ok({ itemId: i.itemId, removed: true });
      }
    }
    throw new Error(`unexpected ${cap.name}`);
  }),
}));

import { addDays, weekendDate } from '@/domain/trip-planner';

const { savePlannerPlace, removePlannerPlace, savePlannerOwn, removePlannerOwn, savePlannerPrefs, refreshPlanner } = await import('@/app/(guest)/guests/travel/planner-actions');
const { loadPlanner } = await import('@/app/(guest)/guests/travel/planner-data');

const planner = (placeId: string, day = 'sat', part = 'morning', id = ulid(store.next++)): Row => ({
  id,
  kind: 'other',
  status: 'planned',
  title: `Title of ${placeId}`,
  startAt: '2031-05-10T08:00',
  endAt: '2031-05-10T12:00',
  provider: 'planner',
  details: { placeId, day, part },
});
const flight = (): Row => ({ id: ulid(store.next++), kind: 'flight', status: 'confirmed', title: 'Flight in', startAt: '2031-05-09T15:00:00.000Z', endAt: null, provider: 'united', details: { placeId: 'bean-house', flightNumber: 'UA 1' } });
const plannerRows = (placeId: string) => store.rows.filter((r) => r.provider === 'planner' && r.details.placeId === placeId);

beforeEach(() => {
  store.rows = [];
  store.next = 1;
  store.calls = [];
  store.prefs = null;
  store.prefsAt = null;
  store.records = { adults: 2, children: 1, dietary: null, accessibility: null };
});

describe('planner actions, keyed on the place', () => {
  it('saving a place twice (a double tap, or add then move) keeps one planner row, at the last time', async () => {
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sun', part: 'afternoon' })).toMatchObject({ ok: true });
    expect(plannerRows('bean-house')).toHaveLength(1);
    expect(plannerRows('bean-house')[0]!.details).toMatchObject({ day: 'sun', part: 'afternoon' });
  });

  it('a place saved for a day before or after the weekend is kept on that day; a day outside the stay is refused', async () => {
    const thu = addDays(weekendDate('fri'), -1);
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'fri', part: 'evening', date: thu })).toMatchObject({ ok: true });
    const row = plannerRows('bean-house')[0]!;
    expect(row.details).toMatchObject({ day: 'fri', part: 'evening', date: thu });
    expect(row.startAt.startsWith(thu)).toBe(true);
    // Back onto the weekend: the date of its own goes.
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sun', part: 'morning' })).toMatchObject({ ok: true });
    expect(plannerRows('bean-house')[0]!.details.date).toBeUndefined();
    // A Saturday evening by date is still the wedding.
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'evening', date: weekendDate('sat') })).toMatchObject({ ok: false });
    // Weeks away is not part of anyone's stay.
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'fri', part: 'morning', date: addDays(weekendDate('fri'), -30) })).toMatchObject({ ok: false });
  });

  it('a save tidies up duplicate planner rows for the same place', async () => {
    store.rows.push(planner('bean-house'), planner('bean-house', 'fri', 'evening'));
    await savePlannerPlace({ placeId: 'bean-house', day: 'sun', part: 'morning' });
    expect(plannerRows('bean-house')).toHaveLength(1);
    expect(plannerRows('bean-house')[0]!.details).toMatchObject({ day: 'sun', part: 'morning' });
  });

  it('removing a place deletes every planner row for it, and nothing else', async () => {
    const booking = flight();
    store.rows.push(planner('bean-house'), planner('bean-house', 'fri', 'evening'), planner('art-museum'), booking);
    expect(await removePlannerPlace({ placeId: 'bean-house' })).toEqual({ ok: true });
    expect(plannerRows('bean-house')).toHaveLength(0);
    expect(plannerRows('art-museum')).toHaveLength(1);
    expect(store.rows).toContainEqual(booking);
    // Already gone is what the guest asked for.
    expect(await removePlannerPlace({ placeId: 'bean-house' })).toEqual({ ok: true });
  });

  it('never edits or deletes a booking, whatever id the browser sends', async () => {
    const booking = flight();
    store.rows.push(booking);
    const before = structuredClone(booking);
    // An id from the page (a stale one, or a booking's own) is not trusted: the place is the key.
    await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning', itemId: booking.id } as never);
    expect(store.rows.find((r) => r.id === booking.id)).toEqual(before);
    expect(plannerRows('bean-house')).toHaveLength(1);
    await removePlannerPlace({ placeId: 'bean-house', itemId: booking.id } as never);
    expect(store.rows).toEqual([before]);
    expect(store.calls.filter((c) => c.cap === 'update_trip_item' || c.cap === 'remove_trip_item').every((c) => (c.input as { itemId: string }).itemId !== booking.id)).toBe(true);
  });

  it('a planner row removed elsewhere (on /trip, in another tab) does not break the next save', async () => {
    await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning' });
    const gone = plannerRows('bean-house')[0]!.id;
    store.rows = [];
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sun', part: 'morning', itemId: gone } as never)).toMatchObject({ ok: true });
    expect(plannerRows('bean-house')).toHaveLength(1);
  });
});

describe('the guest’s own plans', () => {
  const own = () => store.rows.filter((r) => r.provider === 'planner' && !r.details.placeId);

  it('saves a plan in the guest’s words as an item of theirs with no place, moves it by its item, and removes only it', async () => {
    const first = await savePlannerOwn({ title: '  Dinner with   family ', day: 'fri', part: 'evening' });
    expect(first).toMatchObject({ ok: true });
    expect(own()).toHaveLength(1);
    expect(own()[0]).toMatchObject({ kind: 'other', title: 'Dinner with family', details: { day: 'fri', part: 'evening' } });
    expect(own()[0]!.startAt.startsWith(weekendDate('fri'))).toBe(true);
    const itemId = (first as { itemId: string }).itemId;
    // The same plan at another time is the same item, not a second one.
    expect(await savePlannerOwn({ itemId, title: 'Dinner with family', day: 'sun', part: 'morning' })).toMatchObject({ ok: true, itemId });
    expect(own()).toHaveLength(1);
    expect(own()[0]!.details).toMatchObject({ day: 'sun', part: 'morning' });
    // Two plans with the same words are two plans.
    await savePlannerOwn({ title: 'Dinner with family', day: 'fri', part: 'evening' });
    expect(own()).toHaveLength(2);
    expect(await removePlannerOwn({ itemId })).toEqual({ ok: true });
    expect(own()).toHaveLength(1);
    // Already gone is what was asked for.
    expect(await removePlannerOwn({ itemId })).toEqual({ ok: true });
  });

  it('keeps a day of the stay outside the weekend, and refuses the wedding’s hours, a day outside the stay and an empty name', async () => {
    const thu = addDays(weekendDate('fri'), -1);
    expect(await savePlannerOwn({ title: 'Busy', day: 'fri', part: 'morning', date: thu })).toMatchObject({ ok: true });
    expect(own()[0]!.details).toMatchObject({ date: thu, part: 'morning' });
    expect(await savePlannerOwn({ title: 'Busy', day: 'sat', part: 'evening' })).toMatchObject({ ok: false });
    expect(await savePlannerOwn({ title: 'Busy', day: 'sat', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerOwn({ title: 'Busy', day: 'fri', part: 'morning', date: addDays(weekendDate('fri'), -40) })).toMatchObject({ ok: false });
    expect(await savePlannerOwn({ title: '   ', day: 'fri', part: 'morning' })).toMatchObject({ ok: false });
    // The page's field stops at 80 characters; anything longer did not come from it.
    expect(await savePlannerOwn({ title: 'x'.repeat(80), day: 'fri', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerOwn({ title: 'x'.repeat(81), day: 'fri', part: 'morning' })).toMatchObject({ ok: false });
  });

  it('never edits or deletes a booking or a saved place, whatever id the browser sends', async () => {
    const booking = flight();
    const place = planner('bean-house');
    store.rows.push(booking, place);
    const before = structuredClone([booking, place]);
    for (const itemId of [booking.id, place.id, 'not-an-id']) {
      await savePlannerOwn({ itemId, title: 'Mine now', day: 'fri', part: 'morning' });
      await removePlannerOwn({ itemId });
    }
    expect(store.rows.filter((r) => r.id === booking.id || r.id === place.id)).toEqual(before);
  });

  it('comes back from loadPlanner as the guest’s own, beside their saved places', async () => {
    await savePlannerOwn({ title: 'Brunch with Aunt Ruth', day: 'sun', part: 'morning' });
    store.rows.push(planner('bean-house'));
    const data = await loadPlanner({ kind: 'guest', guestId: 'g', householdId: 'h' } as never);
    const mine = data.saved.find((s) => s.own)!;
    expect(mine).toMatchObject({ id: `own:${own()[0]!.id}`, name: 'Brunch with Aunt Ruth', day: 'sun', part: 'morning', itemId: own()[0]!.id });
    expect(data.saved.filter((s) => !s.own).map((s) => s.id)).toEqual(['bean-house']);
  });
});

describe('loadPlanner', () => {
  it('shows a place once however many planner rows it has', async () => {
    store.rows.push(planner('bean-house'), planner('bean-house', 'fri', 'evening'), planner('art-museum', 'sun', 'morning'));
    const data = await loadPlanner({ kind: 'guest', guestId: 'g', householdId: 'h' } as never);
    expect(data.saved.map((s) => s.id).sort()).toEqual(['art-museum', 'bean-house']);
  });
});

describe('who the planner plans for', () => {
  const guest = { kind: 'guest', guestId: 'g1', householdId: 'h1' } as never;

  it('starts from the party the invitation and RSVP give, and what the RSVP says they eat', async () => {
    store.records = { adults: 2, children: 1, dietary: 'Vegetarian, and a peanut allergy', accessibility: 'Uses a wheelchair' };
    const { profile, prefs } = await loadPlanner(guest);
    expect(profile.party).toEqual({ adults: 2, children: 1 });
    expect(profile).toMatchObject({ kids: true, diet: ['vegetarian'], allergy: 'peanut', stepFree: true, asked: true, saved: false });
    expect(profile.from).toEqual({ diet: 'rsvp', stepFree: 'rsvp', shortWalks: null, kids: 'rsvp' });
    expect(prefs).toEqual({ value: null, updatedAt: null });
  });

  it('saves what the guest sets, and their own answer wins over the RSVP', async () => {
    store.records = { adults: 2, children: 1, dietary: 'vegetarian', accessibility: null };
    const r = await savePlannerPrefs({ prefs: { diet: ['vegan'], meal: 'quick', budget: 2, stepFree: false, shortWalks: true, interests: ['coffee'], kids: false, asked: true } });
    expect(r).toMatchObject({ ok: true, conflict: false });
    if (!r.ok) return;
    expect(r.profile).toMatchObject({ diet: ['vegan'], budget: 2, shortWalks: true, kids: false, interests: ['coffee'], saved: true });
    expect(r.profile.from).toMatchObject({ diet: 'you', kids: 'you' });
    expect((await loadPlanner(guest)).profile.diet).toEqual(['vegan']);
  });

  it('drops anything the page sends that is not a preference', async () => {
    const r = await savePlannerPrefs({ prefs: { diet: ['vegan', 'carnivore'], meal: 'banquet', budget: 9, stepFree: 'yes', interests: ['coffee', 'gossip'], kids: 'maybe', notes: '<script>' } as never });
    expect(r).toMatchObject({ ok: true, prefs: { diet: ['vegan'], meal: null, budget: null, stepFree: null, shortWalks: null, interests: ['coffee'], kids: null, asked: false } });
  });

  it('saving nothing clears what was saved', async () => {
    await savePlannerPrefs({ prefs: { diet: ['vegan'], meal: null, budget: null, stepFree: false, shortWalks: false, interests: [], kids: null, asked: false } });
    const r = await savePlannerPrefs({ prefs: { diet: null, meal: null, budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: false } });
    expect(r).toMatchObject({ ok: true, prefs: null, updatedAt: null });
    expect(store.prefs).toBeNull();
  });

  it('does not overwrite a change made on another device since the page read it', async () => {
    const first = await savePlannerPrefs({ prefs: { diet: ['vegan'], meal: null, budget: null, stepFree: false, shortWalks: false, interests: [], kids: null, asked: false }, basedOn: null });
    expect(first).toMatchObject({ ok: true, conflict: false });
    // A second page still holds "nothing saved" and tries to save its own.
    const stale = await savePlannerPrefs({ prefs: { diet: ['kosher'], meal: null, budget: null, stepFree: false, shortWalks: false, interests: [], kids: null, asked: false }, basedOn: null });
    expect(stale).toMatchObject({ ok: true, conflict: true, prefs: { diet: ['vegan'] } });
    expect(store.prefs).toMatchObject({ diet: ['vegan'] });
  });

  it('refreshPlanner returns the plans and profile as they are now', async () => {
    await savePlannerPlace({ placeId: 'the-aviary', day: 'fri', part: 'evening' });
    await savePlannerPrefs({ prefs: { diet: [], meal: null, budget: 1, stepFree: false, shortWalks: false, interests: [], kids: null, asked: false } });
    const r = await refreshPlanner();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saved.map((s) => s.id)).toEqual(['the-aviary']);
    expect(r.profile.budget).toBe(1);
  });
});
