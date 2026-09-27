import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adminDeleteEvent,
  adminDeleteNotice,
  adminListEvents,
  adminReorderEvents,
  adminSetEventEntitlements,
  adminSetMealOptions,
  adminUpsertEvent,
  adminUpsertNotice,
} from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { eventEntitlements, events, invitations, mealOptions, rsvpResponses, weekendNotices } from '@/db/schema';
import { FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { seedEventsAndPlans } from '@/domain/events/seed';
import { listAuditEvents } from '@/lib/audit';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * The events screen's destructive and ordering capabilities: deleting an event (refused once anyone
 * has answered it; otherwise it takes its invitations, menus and invitation-link keys with it),
 * moving events with Up/Down, and deleting a Your Weekend notice.
 */
const admin = fixtureAdmin();
const staleAdmin = fixtureAdmin({ authenticatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
const contentOnly = fixtureAdmin({ entitlements: new Set(['admin_content']) as never });
const A1 = fixturePrincipal('A1');
const E = FX.events;
let db: Db;

const eventInput = (name: string, extra: Record<string, unknown> = {}) => ({ name, dateIso: '2027-07-18', placeholder: true, rsvpRequired: true, ...extra });
const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const addInvitation = async (eventKeys: string[]) => {
  const id = newId();
  await db.insert(invitations).values({ id, householdId: FX.householdC, tokenHash: `hash-${id}`, tokenPrefix: id.slice(0, 6), eventKeys, expiresAt: new Date('2027-08-01T00:00:00Z'), issuedBy: { kind: 'system', component: 'test' } });
  return id;
};

beforeAll(async () => {
  db = await seedSwarmE();
});

describe('admin_upsert_event without a position', () => {
  it('puts a new event last, and an edit keeps its place and its key', async () => {
    const before = expectOk(await run(adminListEvents, admin, {})).data.events;
    const last = Math.max(...before.map((e) => e.sortOrder));
    const brunch = expectOk(await run(adminUpsertEvent, admin, eventInput('Farewell brunch'))).data;
    expect(brunch.sortOrder).toBe(last + 10);
    expect(brunch.slug).toBe('farewell-brunch');

    const renamed = expectOk(await run(adminUpsertEvent, admin, eventInput('Sunday farewell brunch', { id: brunch.id, placeholder: false }))).data;
    expect(renamed).toMatchObject({ sortOrder: brunch.sortOrder, slug: 'farewell-brunch', name: 'Sunday farewell brunch', placeholder: false });
    await db.delete(events).where(eq(events.id, brunch.id));
  });
});

describe('admin_reorder_events', () => {
  it('swaps two events in one save and changes nothing else about them', async () => {
    const [ceremony, reception] = [await eventRow(E.ceremony), await eventRow(E.reception)];
    const r = expectOk(await run(adminReorderEvents, admin, { moves: [{ id: E.reception, sortOrder: ceremony!.sortOrder }, { id: E.ceremony, sortOrder: reception!.sortOrder }] }));
    expect(r.data.applied).toBe(2);
    const listed = expectOk(await run(adminListEvents, admin, {})).data.events.map((e) => e.id);
    expect(listed.indexOf(E.reception)).toBeLessThan(listed.indexOf(E.ceremony));
    expect(await eventRow(E.reception)).toMatchObject({ name: reception!.name, slug: reception!.slug, mealOptionsVersion: reception!.mealOptionsVersion, sortOrder: ceremony!.sortOrder });
    // And back, so the rest of this file sees the seed's order.
    expectOk(await run(adminReorderEvents, admin, { moves: [{ id: E.reception, sortOrder: reception!.sortOrder }, { id: E.ceremony, sortOrder: ceremony!.sortOrder }] }));
  });

  it('refuses an unknown event, the same event twice, and a guest', async () => {
    const unknown = expectErr(await run(adminReorderEvents, admin, { moves: [{ id: E.ceremony, sortOrder: 1 }, { id: newId(), sortOrder: 2 }] }));
    expect(unknown.code).toBe('not_found');
    expect((await eventRow(E.ceremony))!.sortOrder).not.toBe(1);
    expect(expectErr(await run(adminReorderEvents, admin, { moves: [{ id: E.ceremony, sortOrder: 1 }, { id: E.ceremony, sortOrder: 2 }] })).code).toBe('validation');
    expect(expectErr(await run(adminReorderEvents, A1, { moves: [{ id: E.ceremony, sortOrder: 1 }] })).code).toBe('forbidden');
  });
});

describe('admin_delete_event', () => {
  it('asks a stale session to step up, and refuses a content-only admin and a guest', async () => {
    expect(adminDeleteEvent.stepUp).toBe(true);
    expect(expectErr(await run(adminDeleteEvent, staleAdmin, { id: E.cocktailHour })).code).toBe('step_up_required');
    expect(expectErr(await run(adminDeleteEvent, contentOnly, { id: E.cocktailHour })).code).toBe('forbidden');
    expect(expectErr(await run(adminDeleteEvent, A1, { id: E.cocktailHour })).code).toBe('forbidden');
    expect(await eventRow(E.cocktailHour)).toBeTruthy();
  });

  it('refuses an event somebody has answered, says why in words, and deletes nothing', async () => {
    await db.insert(rsvpResponses).values({ id: newId(), guestId: FX.guestA1, eventId: E.ceremony, status: 'accepted', submittedBy: { kind: 'system', component: 'test' } });
    const listed = expectOk(await run(adminListEvents, admin, {})).data.events.find((e) => e.id === E.ceremony)!;
    expect(listed.responseCount).toBe(1);

    const e = expectErr(await run(adminDeleteEvent, admin, { id: E.ceremony }));
    expect(e.code).toBe('conflict');
    expect(e.message).toBe('Ceremony cannot be deleted: one guest has already answered its RSVP, and their answers would be lost. Edit the event instead.');
    expect(await eventRow(E.ceremony)).toBeTruthy();
    expect(await db.select().from(eventEntitlements).where(eq(eventEntitlements.eventId, E.ceremony))).not.toHaveLength(0);
    expect(await db.select().from(rsvpResponses).where(eq(rsvpResponses.eventId, E.ceremony))).toHaveLength(1);
  });

  it('deletes an unanswered event with its invitations, menus and its key on every link, audited', async () => {
    const brunch = expectOk(await run(adminUpsertEvent, admin, eventInput('Farewell brunch'))).data;
    expectOk(await run(adminSetMealOptions, admin, { eventId: brunch.id, options: [{ label: 'Pancakes' }, { label: 'Eggs' }] }));
    expectOk(await run(adminSetMealOptions, admin, { eventId: brunch.id, options: [{ label: 'Waffles' }] }));
    expectOk(await run(adminSetEventEntitlements, admin, { changes: [FX.guestA1, FX.guestB1].map((guestId) => ({ guestId, eventId: brunch.id, invited: true })) }));
    const both = await addInvitation(['ceremony', 'farewell-brunch']);
    const other = await addInvitation(['reception']);

    const r = expectOk(await run(adminDeleteEvent, admin, { id: brunch.id }, { requestId: 'req-delete-brunch' }));
    expect(r.data).toEqual({ deleted: true, name: 'Farewell brunch', entitlementsRemoved: 2, mealOptionsRemoved: 3, invitationsUpdated: 1 });

    expect(await eventRow(brunch.id)).toBeUndefined();
    expect(await db.select().from(eventEntitlements).where(eq(eventEntitlements.eventId, brunch.id))).toHaveLength(0);
    expect(await db.select().from(mealOptions).where(eq(mealOptions.eventId, brunch.id))).toHaveLength(0);
    const links = await db.select().from(invitations);
    expect(links.find((l) => l.id === both)!.eventKeys).toEqual(['ceremony']);
    expect(links.find((l) => l.id === other)!.eventKeys).toEqual(['reception']);

    const audit = (await listAuditEvents(db, { requestId: 'req-delete-brunch', action: 'content.updated' }))[0];
    expect(audit).toMatchObject({ targetType: 'event', targetId: brunch.id });
    expect(audit?.metadata).toMatchObject({ op: 'delete', slug: 'farewell-brunch', entitlementsRemoved: 2 });

    // Deleted already: a second try says so rather than pretending.
    expect(expectErr(await run(adminDeleteEvent, admin, { id: brunch.id })).code).toBe('not_found');
  });

  it('keeps a deleted seed event deleted when the seed runs again (every boot and db:seed)', async () => {
    const invited = await db.select().from(eventEntitlements).where(eq(eventEntitlements.eventId, E.cocktailHour));
    expect(invited.length).toBeGreaterThan(0);
    const r = expectOk(await run(adminDeleteEvent, admin, { id: E.cocktailHour }));
    expect(r.data.entitlementsRemoved).toBe(invited.length);
    await seedEventsAndPlans(db);
    expect(await eventRow(E.cocktailHour)).toBeUndefined();
    expect(await eventRow(E.ceremony)).toBeTruthy();
  });
});

describe('admin_delete_notice', () => {
  it('deletes a notice for good, and refuses a guest and a notice that is gone', async () => {
    const n = expectOk(await run(adminUpsertNotice, admin, { title: 'Shuttle moved', body: 'Pick-up is now at the north door.', severity: 'info', active: true })).data;
    expect(expectErr(await run(adminDeleteNotice, A1, { id: n.id })).code).toBe('forbidden');
    expect(expectOk(await run(adminDeleteNotice, admin, { id: n.id }, { requestId: 'req-delete-notice' })).data).toEqual({ deleted: true, title: 'Shuttle moved' });
    expect(await db.select().from(weekendNotices).where(eq(weekendNotices.id, n.id))).toHaveLength(0);
    expect(expectOk(await run(adminListEvents, admin, {})).data.notices.some((x) => x.id === n.id)).toBe(false);
    expect((await listAuditEvents(db, { requestId: 'req-delete-notice', action: 'content.updated' }))[0]).toMatchObject({ targetType: 'weekend_notice', targetId: n.id });
    expect(expectErr(await run(adminDeleteNotice, admin, { id: n.id })).code).toBe('not_found');
  });
});
