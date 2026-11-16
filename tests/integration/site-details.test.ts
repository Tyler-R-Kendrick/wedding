import { beforeAll, describe, expect, it } from 'vitest';
import { adminSetRsvpWindow } from '@/capabilities/rsvp';
import { getVenueFacts } from '@/capabilities/get_venue_facts';
import { adminSiteDetails, adminUpdateSiteDetails } from '@/capabilities/ops';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { getSiteSettings } from '@/db/repos/site';
import { FX } from '@/db/seed/fixtures';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_content']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-DETAILS' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'details-session',
});

const details = async () => expectOk(await run(adminSiteDetails, admin(), {})).data;
const fact = (d: Awaited<ReturnType<typeof details>>, key: string) => d.groups.flatMap((g) => g.facts).find((f) => f.key === key)!;

/**
 * The Details screen's two capabilities through the pipeline: the list is what the records say, an
 * edit made there is one write that the readers of the site record then return, and the edit
 * carried by a fact is a call the pipeline accepts as it stands.
 */
describe('admin_site_details', () => {
  beforeAll(async () => {
    await seedSwarmE();
  });

  it('is for content administrators, and never offered to the concierge or WebMCP', async () => {
    for (const cap of [adminSiteDetails, adminUpdateSiteDetails]) expect(cap.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(expectErr(await run(adminSiteDetails, admin(['admin_guest_ops']), {})).code).toBe('forbidden');
    expect(expectErr(await run(adminUpdateSiteDetails, admin(['admin_guest_ops']), { venueName: 'Somewhere Else' })).code).toBe('forbidden');
    expect(expectErr(await run(adminSiteDetails, { kind: 'guest', guestId: FX.guestA1 } as unknown as Principal, {})).code).toBe('forbidden');
  });

  it('lists the shared facts by group with where each shows, and counts what is undecided', async () => {
    const d = await details();
    expect(d.groups.map((g) => g.id)).toEqual(expect.arrayContaining(['day', 'replies', 'schedule', 'stay']));
    expect(fact(d, 'wedding.date')).toMatchObject({ value: 'Saturday, July 17, 2027', state: 'set' });
    expect(fact(d, 'venue.name').value).toBe('Chicago Athletic Association Hotel');
    // The seed has no reply-by time and no event times: the screen says so instead of showing blanks.
    expect(fact(d, 'rsvp.deadline').state).toBe('todo');
    expect(d.groups.find((g) => g.id === 'schedule')!.facts.every((f) => f.state === 'todo')).toBe(true);
    expect(d.counts.todo).toBeGreaterThan(0);
    for (const f of d.groups.flatMap((g) => g.facts)) expect(f.shownOn.length, f.key).toBeGreaterThan(0);
  });

  it('one save moves the venue name for the list and for what guests and agents are told', async () => {
    const before = (await getSiteSettings(await getDb()))!;
    const saved = expectOk(await run(adminUpdateSiteDetails, admin(), { venueName: 'The Athletic Association' })).data;
    expect(saved).toMatchObject({ venueName: 'The Athletic Association', changed: ['venueName'] });
    expect(fact(await details(), 'venue.name')).toMatchObject({ value: 'The Athletic Association', state: 'differs' });
    const told = expectOk(await run(getVenueFacts, { kind: 'guest', guestId: FX.guestA1, householdId: FX.householdA, actsFor: [FX.guestA1], entitlements: new Set(), authIdentityId: 'G', authenticatedAt: new Date().toISOString(), sessionId: 's' } as unknown as Principal, {})).data;
    expect(told.venueName).toBe('The Athletic Association');
    // Saving what is already there changes nothing and says so.
    expect(expectOk(await run(adminUpdateSiteDetails, admin(), { venueName: 'The Athletic Association' })).data.changed).toEqual([]);
    expectOk(await run(adminUpdateSiteDetails, admin(), { venueName: before.venueName }));
    expect(fact(await details(), 'venue.name').state).toBe('set');
  });

  it('refuses a date that is not a date, an address that is not https, and an empty change', async () => {
    expect(expectErr(await run(adminUpdateSiteDetails, admin(), { weddingDate: '17 July 2027' })).code).toBe('validation');
    expect(expectErr(await run(adminUpdateSiteDetails, admin(), { weddingDate: '2027-13-45' })).code).toBe('validation');
    // A day the calendar does not have: Date.parse would roll it into March.
    expect(expectErr(await run(adminUpdateSiteDetails, admin(), { weddingDate: '2027-02-31' })).code).toBe('validation');
    expect(expectErr(await run(adminUpdateSiteDetails, admin(), { venueUrl: 'http://example.com' })).code).toBe('validation');
    expect(expectErr(await run(adminUpdateSiteDetails, admin(), {})).code).toBe('validation');
  });

  it('a moved date is flagged against the copy the code keeps, and moving it back clears the flag', async () => {
    expectOk(await run(adminUpdateSiteDetails, admin(), { weddingDate: '2027-07-24' }));
    const moved = fact(await details(), 'wedding.date');
    expect(moved).toMatchObject({ value: 'Saturday, July 24, 2027', state: 'differs' });
    expect(moved.copies.length).toBeGreaterThan(0);
    expectOk(await run(adminUpdateSiteDetails, admin(), { weddingDate: '2027-07-17' }));
    expect(fact(await details(), 'wedding.date').state).toBe('set');
  });

  it('the edit a fact carries is a call the pipeline takes as it stands', async () => {
    const deadline = fact(await details(), 'rsvp.deadline').edit;
    if (deadline.kind !== 'here') throw new Error('the reply-by time is edited in place');
    expect(deadline.capability).toBe('admin_set_rsvp_window');
    expectOk(await run(adminSetRsvpWindow, admin(), { ...deadline.base, [deadline.field]: '2027-06-20T05:00:00.000Z' }));
    expect(fact(await details(), 'rsvp.deadline')).toMatchObject({ state: 'set' });
    expectOk(await run(adminSetRsvpWindow, admin(), { ...deadline.base, [deadline.field]: null }));
  });
});
