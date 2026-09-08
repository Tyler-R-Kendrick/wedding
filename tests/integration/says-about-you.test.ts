import { beforeAll, describe, expect, it } from 'vitest';
import { getMyItinerary } from '@/capabilities/weekend/get_my_itinerary';
import { requestOtp } from '@/capabilities/request_otp';
import { SEATING_MESSAGE } from '@/capabilities/seating/get_my_table';
import type { Db } from '@/db/client';
import { FX, fixturePrincipal } from '@/db/seed/fixtures';
import { issueInvitation } from '@/domain/invitations/repo';
import { expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * What the site says about YOU.
 *
 * A guest review built the people who do not fit the happy path — a guest with no email of their
 * own, a non-manager, a solo household, someone not on the seating chart — and found the site
 * describing each of them as somebody else.
 */

let db: Db;
const anonymous = { kind: 'anonymous' } as const;
const actor = { kind: 'system', component: 'test' } as const;
const audit = { record: async () => 'audit-test-id' as never };

beforeAll(async () => {
  db = await seedSwarmE();
});

describe('seating', () => {
  it('distinguishes "no chart yet" from "you are not on it" from "not your invitation"', async () => {
    // One sentence — "Your table will appear here once seating is published" — used to cover all
    // three. A guest added late, one who declined, a child or a plus-one all read that the chart
    // does not exist yet and waited for something that had already happened.
    expect(new Set(Object.values(SEATING_MESSAGE)).size).toBe(3);
    expect(SEATING_MESSAGE.not_seated).toContain('published, and you are not on it');
    expect(SEATING_MESSAGE.not_entitled).not.toContain('once seating is published');

    // Nothing is published in this world, so A1 gets the first of the three.
    const mine = expectOk(await run(getMyItinerary, fixturePrincipal('A1'), {}));
    expect(mine.data.seating.state).toBe('not_published');
    expect(mine.data.seating.message).toBe(SEATING_MESSAGE.not_published);

    // Without the entitlement the query is never reached, and that is its own sentence.
    const noSeat = fixturePrincipal('A1', { entitlements: new Set(['view_event', 'rsvp_self', 'view_private_schedule', 'use_concierge']) as never });
    const theirs = expectOk(await run(getMyItinerary, noSeat, {}));
    expect(theirs.data.seating.state).toBe('not_entitled');
    expect(theirs.data.seating.message).toBe(SEATING_MESSAGE.not_entitled);
  });
});

describe('the RSVP block on Your Weekend', () => {
  it('does not offer the primary button to someone who may not answer', async () => {
    // `derive.ts` strips `rsvp_self` from exactly one binding role — a delegate — and the button was
    // gated on the window being open and nothing else, so it led to a 403.
    const manager = expectOk(await run(getMyItinerary, fixturePrincipal('A1'), {}));
    expect(manager.data.rsvp.canAnswer).toBe(true);
    const delegate = fixturePrincipal('A1', { entitlements: new Set(['view_event', 'view_private_schedule', 'use_concierge']) as never });
    expect(expectOk(await run(getMyItinerary, delegate, {})).data.rsvp.canAnswer).toBe(false);
  });

  it('says "for everyone" only when the counts cover more than one person', async () => {
    // The counts come from `actsFor`, so for a non-manager they are ONE person — and the badge read
    // "Answered for everyone" once that person alone had answered.
    expect(expectOk(await run(getMyItinerary, fixturePrincipal('A1'), {})).data.rsvp.scope).toBe('household');
    expect(expectOk(await run(getMyItinerary, fixturePrincipal('A2'), {})).data.rsvp.scope).toBe('self');
    expect(expectOk(await run(getMyItinerary, fixturePrincipal('C1'), {})).data.rsvp.scope).toBe('self');
  });
});

describe('claiming for someone with no email of their own', () => {
  it('reports who was picked, so the next page can reconcile it with who you become', async () => {
    // Eve has no email; the code goes to Dev, the session becomes Dev, and every page then called
    // her Dev — "Welcome, Dev", "you manage the RSVP for your household". The binding is right
    // (ADR-0001); saying nothing about it is what was wrong.
    const meta = { issuedBy: actor, actor, requestId: 'test', audit, now: new Date() };
    const issued = await issueInvitation(db, { householdId: FX.householdB, ...meta });
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    const token = issued.ok ? issued.value.token : '';

    const forEve = expectOk(await run(requestOtp, anonymous, { purpose: 'claim', token, guestId: FX.guestB2 }));
    expect(forEve.data.sent).toBe(true);
    expect(forEve.data.sent === true && forEve.data.deliveredFor).toBe('Dev Fixture');
    expect(forEve.data.sent === true && forEve.data.claimedFor).toBe('Eve Fixture');

    // Dev picks himself: he has an inbox, binds to himself, and there is nothing to reconcile.
    const forDev = expectOk(await run(requestOtp, anonymous, { purpose: 'claim', token, guestId: FX.guestB1 }));
    expect(forDev.data.sent === true && forDev.data.claimedFor).toBeNull();
  });
});
