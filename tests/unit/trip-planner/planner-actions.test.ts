import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The planner's server actions against a stand-in for the capability pipeline: a guest's trip items
 * in memory, read and written only through the capabilities the actions name. What is checked is
 * which rows the actions touch, not who may (the capabilities own that).
 */
type Row = { id: string; kind: string; status: string; title: string; startAt: string; endAt: string | null; provider: string | null; details: Record<string, unknown> };

const store = vi.hoisted(() => ({ rows: [] as Row[], next: 1, calls: [] as { cap: string; input: unknown }[] }));
const caps = vi.hoisted(() => ({
  getMyTrip: { name: 'get_my_trip' },
  addTripItemCapability: { name: 'add_trip_item' },
  updateTripItemCapability: { name: 'update_trip_item' },
  removeTripItemCapability: { name: 'remove_trip_item' },
  findAdventures: { name: 'find_adventures' },
  listMyEvents: { name: 'list_my_events' },
}));
vi.mock('@/capabilities/travel', () => ({
  getMyTrip: caps.getMyTrip,
  addTripItemCapability: caps.addTripItemCapability,
  updateTripItemCapability: caps.updateTripItemCapability,
  removeTripItemCapability: caps.removeTripItemCapability,
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

const { savePlannerPlace, removePlannerPlace } = await import('@/app/(guest)/guests/travel/planner-actions');
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
});

describe('planner actions, keyed on the place', () => {
  it('saving a place twice (a double tap, or add then move) keeps one planner row, at the last time', async () => {
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sat', part: 'morning' })).toMatchObject({ ok: true });
    expect(await savePlannerPlace({ placeId: 'bean-house', day: 'sun', part: 'afternoon' })).toMatchObject({ ok: true });
    expect(plannerRows('bean-house')).toHaveLength(1);
    expect(plannerRows('bean-house')[0]!.details).toMatchObject({ day: 'sun', part: 'afternoon' });
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

describe('loadPlanner', () => {
  it('shows a place once however many planner rows it has', async () => {
    store.rows.push(planner('bean-house'), planner('bean-house', 'fri', 'evening'), planner('art-museum', 'sun', 'morning'));
    const data = await loadPlanner({ kind: 'guest', guestId: 'g', householdId: 'h' } as never);
    expect(data.saved.map((s) => s.id).sort()).toEqual(['art-museum', 'bean-house']);
  });
});
