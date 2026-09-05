import { eq } from 'drizzle-orm';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, Entitlement, GuestPrincipal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { eventEntitlements, events, guests, households, mealOptions } from '@/db/schema';
import { SEED_EVENT_IDS } from '@/domain/events/seed';
import { fixtureId } from './ids';

/**
 * TEST-ONLY fixture households. Names are obviously fictional; never real guests.
 * Used by integration tests directly and by the e2e/security servers via SEED_TEST_FIXTURES=1
 * (refused in production). Ids are deterministic so specs can reference them.
 *
 *  Household A (manager A1): A1, A2 (spouse), A3 (child, minor). Invited to everything; no plus-ones.
 *  Household B (manager B1): B1 (reception plus-one: named), B2 (NOT invited to the ceremony).
 *  Household C (solo C1): reception plus-one: unnamed.
 */
export const FX = {
  householdA: fixtureId<HouseholdId>('HHA'),
  householdB: fixtureId<HouseholdId>('HHB'),
  householdC: fixtureId<HouseholdId>('HHC'),
  guestA1: fixtureId<GuestId>('GSTA1'),
  guestA2: fixtureId<GuestId>('GSTA2'),
  guestA3: fixtureId<GuestId>('GSTA3'),
  guestB1: fixtureId<GuestId>('GSTB1'),
  guestB2: fixtureId<GuestId>('GSTB2'),
  guestC1: fixtureId<GuestId>('GSTC1'),
  mealBeef: fixtureId('MEALBEEF'),
  mealFish: fixtureId('MEALFISH'),
  mealGarden: fixtureId('MEALGARDEN'),
  events: SEED_EVENT_IDS,
} as const;

export const FIXTURE_GUESTS = [
  { id: FX.guestA1, householdId: FX.householdA, firstName: 'Ada', lastName: 'Testhouse', displayName: 'Ada Testhouse', email: 'ada.testhouse@example.test', isMinor: false },
  { id: FX.guestA2, householdId: FX.householdA, firstName: 'Ben', lastName: 'Testhouse', displayName: 'Ben Testhouse', email: null, isMinor: false },
  { id: FX.guestA3, householdId: FX.householdA, firstName: 'Cleo', lastName: 'Testhouse', displayName: 'Cleo Testhouse', email: null, isMinor: true },
  { id: FX.guestB1, householdId: FX.householdB, firstName: 'Dev', lastName: 'Fixture', displayName: 'Dev Fixture', email: 'dev.fixture@example.test', isMinor: false },
  { id: FX.guestB2, householdId: FX.householdB, firstName: 'Eve', lastName: 'Fixture', displayName: 'Eve Fixture', email: null, isMinor: false },
  { id: FX.guestC1, householdId: FX.householdC, firstName: 'Fin', lastName: 'Solo', displayName: 'Fin Solo', email: 'fin.solo@example.test', isMinor: false },
] as const;

export const FIXTURE_HOUSEHOLDS = [
  { id: FX.householdA, name: 'Testhouse household', managerGuestId: FX.guestA1 },
  { id: FX.householdB, name: 'Fixture household', managerGuestId: FX.guestB1 },
  { id: FX.householdC, name: 'Solo household', managerGuestId: FX.guestC1 },
] as const;

const E = SEED_EVENT_IDS;
export const FIXTURE_ENTITLEMENTS = [
  ...[FX.guestA1, FX.guestA2, FX.guestA3].flatMap((g) => [E.ceremony, E.cocktailHour, E.reception].map((e) => ({ guestId: g, eventId: e, plusOnePolicy: 'none' as const }))),
  { guestId: FX.guestB1, eventId: E.ceremony, plusOnePolicy: 'none' as const },
  { guestId: FX.guestB1, eventId: E.cocktailHour, plusOnePolicy: 'none' as const },
  { guestId: FX.guestB1, eventId: E.reception, plusOnePolicy: 'named' as const },
  { guestId: FX.guestB2, eventId: E.cocktailHour, plusOnePolicy: 'none' as const },
  { guestId: FX.guestB2, eventId: E.reception, plusOnePolicy: 'none' as const },
  { guestId: FX.guestC1, eventId: E.ceremony, plusOnePolicy: 'none' as const },
  { guestId: FX.guestC1, eventId: E.reception, plusOnePolicy: 'unnamed' as const },
] as const;

/** Reception menu, version 1 (test fixture, not a real menu). */
export const FIXTURE_MEALS = [
  { id: FX.mealBeef, label: 'Test entrée A', description: 'Fixture menu item', sortOrder: 1 },
  { id: FX.mealFish, label: 'Test entrée B', description: 'Fixture menu item', sortOrder: 2 },
  { id: FX.mealGarden, label: 'Test entrée C (vegetarian)', description: 'Fixture menu item', sortOrder: 3 },
] as const;

/** Idempotent. Requires the real seed (events) to have run first. */
export async function seedTestFixtures(db: Db, now: Date = new Date()): Promise<void> {
  for (const h of FIXTURE_HOUSEHOLDS) await db.insert(households).values({ ...h, createdAt: now }).onConflictDoNothing({ target: households.id });
  for (const g of FIXTURE_GUESTS) await db.insert(guests).values({ ...g, createdAt: now }).onConflictDoNothing({ target: guests.id });
  for (const [idx, en] of FIXTURE_ENTITLEMENTS.entries()) {
    await db.insert(eventEntitlements).values({ id: fixtureId(`ENT${idx}`), ...en, createdAt: now }).onConflictDoNothing();
  }
  for (const m of FIXTURE_MEALS) await db.insert(mealOptions).values({ ...m, eventId: E.reception, version: 1, createdAt: now }).onConflictDoNothing({ target: mealOptions.id });
  await db.update(events).set({ mealOptionsVersion: 1, hasMeal: true }).where(eq(events.id, E.reception));
}

const ENT = (list: Entitlement[]) => new Set<Entitlement>(list);
const GUEST_ENTITLEMENTS: Entitlement[] = ['view_event', 'rsvp_self', 'view_private_schedule', 'view_table_assignment', 'use_concierge'];

/** Principals matching the fixture households (what Swarm D's resolver will derive). */
export function fixturePrincipal(who: 'A1' | 'A2' | 'B1' | 'B2' | 'C1', over: Partial<GuestPrincipal> = {}): GuestPrincipal {
  const table = {
    A1: { guestId: FX.guestA1, householdId: FX.householdA, actsFor: [FX.guestA1, FX.guestA2, FX.guestA3], manager: true },
    A2: { guestId: FX.guestA2, householdId: FX.householdA, actsFor: [FX.guestA2], manager: false },
    B1: { guestId: FX.guestB1, householdId: FX.householdB, actsFor: [FX.guestB1, FX.guestB2], manager: true },
    B2: { guestId: FX.guestB2, householdId: FX.householdB, actsFor: [FX.guestB2], manager: false },
    C1: { guestId: FX.guestC1, householdId: FX.householdC, actsFor: [FX.guestC1], manager: true },
  }[who];
  return {
    kind: 'guest',
    authIdentityId: fixtureId<AuthIdentityId>(`AUTH${who}`),
    guestId: table.guestId,
    householdId: table.householdId,
    actsFor: table.actsFor,
    entitlements: ENT(table.manager ? [...GUEST_ENTITLEMENTS, 'manage_household_rsvp'] : GUEST_ENTITLEMENTS),
    authenticatedAt: new Date().toISOString(),
    sessionId: `fixture-session-${who}`,
    ...over,
  };
}

export function fixtureAdmin(over: Partial<AdminPrincipal> = {}): AdminPrincipal {
  return {
    kind: 'admin',
    authIdentityId: fixtureId<AuthIdentityId>('AUTHADMIN'),
    adminId: fixtureId<AdminId>('ADMIN1'),
    roles: new Set(['owner']),
    entitlements: ENT(['admin_content', 'admin_guest_ops', 'admin_audit', 'admin_lifecycle']),
    authenticatedAt: new Date().toISOString(),
    sessionId: 'fixture-session-admin',
    ...over,
  };
}
