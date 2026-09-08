import { beforeAll, describe, expect, it } from 'vitest';
import { adminUpsertGuest } from '@/capabilities/admin_guest_ops';
import { getMyRsvp } from '@/capabilities/rsvp';
import type { Db } from '@/db/client';
import { eventEntitlements } from '@/db/schema';
import { FIXTURE_ENTITLEMENTS, FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { deterministicId } from '@/db/seed/ids';
import { listManagedGuests } from '@/domain/guests/repo';
import { listHouseholds } from '@/domain/households/repo';
import { loadHouseholdRsvpContext } from '@/domain/rsvp/repo';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * The household is the boundary. Two guest reviewers reached across it from opposite directions:
 * one by giving a principal an `actsFor` from another household, one by reading the admin Guests
 * screen's free-text "Managed by (guest id)" box and noticing nothing validates it.
 */

const admin = fixtureAdmin();
let db: Db;

beforeAll(async () => {
  db = await seedSwarmE();
});

describe('a guest id from another household', () => {
  it('is refused by the admin screen that used to accept it as free text', async () => {
    // C1 is the only member of household C. Naming them as A2's manager put their name, RSVP and
    // dietary notes inside household A's RSVP form — from one typo, with no second check anywhere.
    const cross = await run(adminUpsertGuest, admin, { id: FX.guestA2, householdId: FX.householdA, firstName: 'Ben', managedByGuestId: FX.guestC1 });
    const e = expectErr(cross);
    expect(e.code).toBe('validation');
    expect(e.message).toContain('different household');
    // and the same guard on the other free-text guest-id field
    const plusOne = await run(adminUpsertGuest, admin, { id: FX.guestA2, householdId: FX.householdA, firstName: 'Ben', plusOneOfGuestId: FX.guestC1 });
    expect(expectErr(plusOne).code).toBe('validation');
    // someone inside the household is still accepted
    expectOk(await run(adminUpsertGuest, admin, { id: FX.guestA2, householdId: FX.householdA, firstName: 'Ben', managedByGuestId: FX.guestA1 }));
  });

  it('is not returned by listManagedGuests even when the row already says so', async () => {
    // Write the bad row straight to the table, as an admin before this fix could.
    const { guests } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(guests).set({ managedByGuestId: FX.guestA1 }).where(eq(guests.id, FX.guestC1));
    const managed = await listManagedGuests(db, [FX.guestA1]);
    expect(managed.map((g) => g.id)).not.toContain(FX.guestC1);
    // the manager's own household is unaffected
    expect(managed.map((g) => g.id).sort()).toEqual([FX.guestA2, FX.guestA3].sort());
  });

  it('is dropped by the RSVP context even when actsFor carries it', async () => {
    const ctx = await loadHouseholdRsvpContext(db, { guestIds: [FX.guestA1, FX.guestC1], householdId: FX.householdA, now: new Date() });
    expect(ctx.guests.map((g) => g.id)).not.toContain(FX.guestC1);
    expect(ctx.entitlements.every((e) => e.guestId !== FX.guestC1)).toBe(true);
  });

  it('never reaches /your-weekend or /rsvp through a forged actsFor', async () => {
    const forged = fixturePrincipal('A1', { actsFor: [FX.guestA1, FX.guestC1] });
    const res = expectOk(await run(getMyRsvp, forged, {}));
    const names = JSON.stringify(res.data);
    expect(names).not.toContain(FX.guestC1);
  });
});

describe('deterministic fixture ids', () => {
  it('refuses two tags that would produce the same id', () => {
    // `padEnd(26, '0')` makes "ZQ1" and "ZQ10" the same 26 characters, and the seeder inserts with
    // onConflictDoNothing — so the second row vanished and the suite stayed green over it. Tags
    // nothing else issues, because the guard is process-wide by design.
    expect(deterministicId('01E2E', 'ZQ1')).toBe('01E2EZQ1000000000000000000');
    expect(() => deterministicId('01E2E', 'ZQ10')).toThrow(/collision/i);
    // the same tag twice is not a collision
    expect(deterministicId('01E2E', 'ZQ1')).toBe('01E2EZQ1000000000000000000');
  });

  it('seeded every fixture entitlement, including the one that used to be dropped', async () => {
    const rows = await db.select().from(eventEntitlements);
    const fixtureRows = rows.filter((r) => r.id.startsWith('01E2EENT'));
    expect(fixtureRows).toHaveLength(FIXTURE_ENTITLEMENTS.length);
    // B1 at the cocktail hour is index 10 — the row `ENT10` collided with `ENT1` and was dropped,
    // so /your-weekend told a guest his wife was invited to the cocktail hour and he was not.
    const b1Cocktail = rows.find((r) => r.guestId === FX.guestB1 && r.eventId === FX.events.cocktailHour);
    expect(b1Cocktail, 'B1 must be entitled to the cocktail hour').toBeTruthy();
  });
});


describe('the admin households screen', () => {
  it('counts the members each household actually has', async () => {
    // Every household read 0 under this driver, so the screen said "Members 0" for three populated
    // households and offered the red Delete button, which is gated on `memberCount === 0`.
    const rows = await listHouseholds(db);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.memberCount]));
    expect(byName['Testhouse household']).toBe(3);
    expect(byName['Fixture household']).toBe(2);
    expect(byName['Solo household']).toBe(1);
    expect(rows.every((r) => r.memberCount > 0)).toBe(true);
  });
});
