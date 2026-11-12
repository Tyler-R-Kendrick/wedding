import { eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { getMyTripProfile, saveMyTripPreferences } from '@/capabilities/travel';
import type { AnyCapability, CapabilityExposure, CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import { newId, type AdminId, type AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Entitlement, GuestPrincipal, Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { getDb } from '@/db/client';
import { guestNeeds, guests, idempotencyKeys, rsvpResponses } from '@/db/schema';
import { guestTripPreferences } from '@/db/schema/travel';
import { FX } from '@/db/seed/fixtures';
import { seedSwarmE } from './helpers/swarm-e';

/**
 * Who the trip planner plans for, against a real database: the party comes from the household and
 * its RSVP, what they eat and how they get around from the RSVP notes of the people this guest
 * answers for (and nobody else's), and the guest's own answers are saved, returned and cleared.
 * The notes themselves never leave: not to an assistant, not into a stored response.
 */
const guest = (guestId: string, householdId: string, actsFor: string[], entitlements: Entitlement[] = ['view_travel_tools']): GuestPrincipal =>
  ({ kind: 'guest', authIdentityId: newId<AuthIdentityId>(), guestId, householdId, actsFor, entitlements: new Set(entitlements), authenticatedAt: new Date().toISOString(), sessionId: 's' }) as unknown as GuestPrincipal;
const managerA = guest(FX.guestA1, FX.householdA, [FX.guestA1, FX.guestA2, FX.guestA3]);
const memberA = guest(FX.guestA2, FX.householdA, [FX.guestA2]);
const soloC = guest(FX.guestC1, FX.householdC, [FX.guestC1]);
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: newId<AuthIdentityId>(), adminId: newId<AdminId>(), roles: new Set(['planner']), entitlements: new Set<Entitlement>(['view_travel_tools', 'admin_guest_ops']), authenticatedAt: new Date().toISOString(), sessionId: 's' } as AdminPrincipal;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: outcomes are asserted structurally
type Loose = Result<CapabilityOutcome<any>, CapabilityError>;
async function run(cap: AnyCapability, principal: Principal, input: unknown, opts: { key?: string; surface?: keyof CapabilityExposure } = {}): Promise<Loose> {
  const ctx = await createCapabilityContext({ principal, requestId: `req-${cap.name}-${newId()}`, surface: opts.surface ?? 'ui', idempotencyKey: opts.key });
  return invoke(cap, ctx, input);
}
const PREFS = { diet: ['kosher'], meal: 'quick', budget: 2, stepFree: false, shortWalks: true, interests: ['coffee', 'view'], kids: null, asked: true };
const by = { kind: 'system' as const, id: 'test' };

beforeAll(async () => {
  await seedSwarmE();
});
beforeEach(async () => {
  const db = await getDb();
  await db.delete(guestTripPreferences);
  await db.delete(guestNeeds);
  await db.delete(rsvpResponses);
});

describe('who the trip planner plans for', () => {
  it('is for a signed-in guest with the travel tools, and for the website only', async () => {
    expect((await run(getMyTripProfile, { kind: 'anonymous' }, {})).ok).toBe(false);
    expect((await run(getMyTripProfile, admin, {})).ok).toBe(false);
    expect((await run(getMyTripProfile, guest(FX.guestC1, FX.householdC, [FX.guestC1], []), {})).ok).toBe(false);
    // An assistant acting for the guest is refused both: the profile is shaped by RSVP notes.
    expect((await run(getMyTripProfile, soloC, {}, { surface: 'ai' })).ok).toBe(false);
    expect((await run(saveMyTripPreferences, soloC, { prefs: PREFS }, { surface: 'webmcp', key: newId() })).ok).toBe(false);
    expect(getMyTripProfile.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(saveMyTripPreferences.exposure).toEqual({ ui: true, ai: false, webmcp: false });
  });

  it('counts the party from the household, and leaves out whoever has said no to everything', async () => {
    const first = await run(getMyTripProfile, managerA, {});
    expect(first.ok && first.value.data.profile).toMatchObject({ party: { adults: 2, children: 1 }, kids: true, diet: [], asked: false, saved: false });
    expect(first.ok && first.value.data.profile.from).toEqual({ diet: null, stepFree: null, shortWalks: null, kids: 'rsvp' });
    const db = await getDb();
    const event = Object.values(FX.events)[0]!;
    const answer = (guestId: string, status: 'accepted' | 'declined') => ({ id: newId(), guestId, eventId: event, status, submittedBy: by, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(rsvpResponses).values([answer(FX.guestA2, 'declined'), answer(FX.guestA3, 'declined')] as never);
    const after = await run(getMyTripProfile, managerA, {});
    expect(after.ok && after.value.data.profile).toMatchObject({ party: { adults: 1, children: 0 }, kids: false });
  });

  it('reads the RSVP notes of the people this guest answers for, and nobody else’s', async () => {
    const db = await getDb();
    await db.insert(guestNeeds).values([
      { guestId: FX.guestA1, dietary: 'Vegetarian', accessibility: null, updatedBy: by },
      { guestId: FX.guestA2, dietary: 'peanut allergy', accessibility: 'Uses a wheelchair', updatedBy: by },
    ] as never);
    // The manager answers for the household: both notes shape the plan.
    const m = await run(getMyTripProfile, managerA, {});
    expect(m.ok && m.value.data.profile).toMatchObject({ diet: ['vegetarian'], allergy: 'peanut', stepFree: true, asked: true });
    expect(m.ok && m.value.data.profile.from).toMatchObject({ diet: 'rsvp', stepFree: 'rsvp' });
    // A member who answers only for themselves is not shown what another adult told us.
    const other = await run(getMyTripProfile, memberA, {});
    expect(other.ok && other.value.data.profile).toMatchObject({ diet: [], allergy: 'peanut', stepFree: true });
    // And the notes' own words are nowhere in what comes back.
    expect(JSON.stringify(m)).not.toMatch(/Uses a wheelchair|peanut allergy/);
  });

  it('saves the guest’s own answers, returns them on the next read, and keeps none of it against the idempotency key', async () => {
    const db = await getDb();
    await db.insert(guestNeeds).values({ guestId: FX.guestC1, dietary: 'vegan', accessibility: null, updatedBy: by } as never);
    const k = newId();
    const saved = await run(saveMyTripPreferences, soloC, { prefs: PREFS, basedOn: null }, { key: k });
    expect(saved.ok && saved.value.data).toMatchObject({ conflict: false, prefs: PREFS, profile: { diet: ['kosher'], budget: 2, shortWalks: true, interests: ['coffee', 'view'], saved: true } });
    expect(saved.ok && saved.value.data.profile.from.diet).toBe('you');
    const read = await run(getMyTripProfile, soloC, {});
    expect(read.ok && read.value.data).toMatchObject({ prefs: PREFS, profile: { diet: ['kosher'] } });
    expect(read.ok && read.value.data.updatedAt).toBe(saved.ok && saved.value.data.updatedAt);
    const [row] = await db.select().from(guestTripPreferences).where(eq(guestTripPreferences.guestId, FX.guestC1));
    expect(row).toMatchObject({ householdId: FX.householdC, prefs: PREFS });
    // Not replayable: nothing about the guest is left in the public idempotency table.
    const kept = await db.select().from(idempotencyKeys);
    expect(JSON.stringify(kept)).not.toMatch(/kosher|vegan/);
  });

  it('refuses what is not a preference', async () => {
    const bad = await run(saveMyTripPreferences, soloC, { prefs: { ...PREFS, diet: ['carnivore'] } }, { key: newId() });
    expect(bad.ok).toBe(false);
    expect((await run(saveMyTripPreferences, soloC, { prefs: { ...PREFS, budget: 9 } }, { key: newId() })).ok).toBe(false);
    expect((await run(saveMyTripPreferences, soloC, { prefs: PREFS }, {})).ok).toBe(false); // an idempotency key is required
  });

  it('does not overwrite answers saved on another device since the page read them', async () => {
    const first = await run(saveMyTripPreferences, soloC, { prefs: PREFS, basedOn: null }, { key: newId() });
    expect(first.ok && first.value.data.conflict).toBe(false);
    // A second page that still thinks nothing is saved.
    const stale = await run(saveMyTripPreferences, soloC, { prefs: { ...PREFS, diet: ['halal'] }, basedOn: null }, { key: newId() });
    expect(stale.ok && stale.value.data).toMatchObject({ conflict: true, prefs: { diet: ['kosher'] } });
    // A page that read the latest saves over it.
    const fresh = await run(saveMyTripPreferences, soloC, { prefs: { ...PREFS, diet: ['halal'] }, basedOn: first.ok ? first.value.data.updatedAt : null }, { key: newId() });
    expect(fresh.ok && fresh.value.data).toMatchObject({ conflict: false, prefs: { diet: ['halal'] } });
  });

  it('saving nothing clears the row, and the RSVP fills in again', async () => {
    const db = await getDb();
    await db.insert(guestNeeds).values({ guestId: FX.guestC1, dietary: 'gluten free', accessibility: null, updatedBy: by } as never);
    await run(saveMyTripPreferences, soloC, { prefs: PREFS }, { key: newId() });
    const cleared = await run(saveMyTripPreferences, soloC, { prefs: { diet: null, meal: null, budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: false } }, { key: newId() });
    expect(cleared.ok && cleared.value.data).toMatchObject({ prefs: null, updatedAt: null, profile: { diet: ['gluten-free'], saved: false } });
    expect(await db.select().from(guestTripPreferences).where(inArray(guestTripPreferences.guestId, [FX.guestC1]))).toEqual([]);
  });

  it('a guest’s preferences go when the guest does', async () => {
    const db = await getDb();
    await run(saveMyTripPreferences, guest(FX.guestB2, FX.householdB, [FX.guestB2]), { prefs: PREFS }, { key: newId() });
    expect(await db.select().from(guestTripPreferences).where(eq(guestTripPreferences.guestId, FX.guestB2))).toHaveLength(1);
    await db.delete(guests).where(eq(guests.id, FX.guestB2));
    expect(await db.select().from(guestTripPreferences).where(eq(guestTripPreferences.guestId, FX.guestB2))).toHaveLength(0);
  });
});
