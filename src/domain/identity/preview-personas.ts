import { eq, inArray } from 'drizzle-orm';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { Entitlement } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { eventEntitlements, events, guests, households, invitations } from '@/db/schema';
import { seedId } from '@/db/seed/ids';
import { SEED_EVENT_IDS } from '@/domain/events/seed';
import type { ViewRoleKey } from './view-role';

/**
 * Synthetic household and guests used only for admin view-role preview. Never bound to a real inbox;
 * labeled in the console as preview data. Ids are deterministic seed rows.
 */
export const PREVIEW = {
  householdId: seedId<HouseholdId>('PREVIEWHH'),
  managerGuestId: seedId<GuestId>('PREVIEWMGR'),
  guestGuestId: seedId<GuestId>('PREVIEWGST'),
  plusOneGuestId: seedId<GuestId>('PREVIEWP1'),
  partyGuestId: seedId<GuestId>('PREVIEWPTY'),
  invitationId: seedId('PREVIEWINV'),
} as const;

const ALL_EVENTS = ['ceremony', 'cocktail-hour', 'reception'] as const;

export function previewGuestIdForRole(role: ViewRoleKey): GuestId {
  switch (role) {
    case 'household_manager':
      return PREVIEW.managerGuestId;
    case 'plus_one':
      return PREVIEW.plusOneGuestId;
    case 'party':
      return PREVIEW.partyGuestId;
    case 'guest':
      return PREVIEW.guestGuestId;
  }
}

export function isPreviewPersonaGuestId(guestId: string): boolean {
  return (
    guestId === PREVIEW.managerGuestId ||
    guestId === PREVIEW.guestGuestId ||
    guestId === PREVIEW.plusOneGuestId ||
    guestId === PREVIEW.partyGuestId
  );
}

export function isPreviewPersonaHouseholdId(householdId: string): boolean {
  return householdId === PREVIEW.householdId;
}

/** Idempotent seed for preview personas. Safe on every boot; never overwrites admin edits to real guests. */
export async function seedPreviewPersonas(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .insert(households)
    .values({
      id: PREVIEW.householdId,
      name: 'Preview household (admin view only)',
      managerGuestId: PREVIEW.managerGuestId,
      notes: 'Synthetic records for administrators previewing guest roles. Not a real invitation.',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const previewGuests = [
    {
      id: PREVIEW.managerGuestId,
      householdId: PREVIEW.householdId,
      firstName: 'Preview',
      lastName: 'Manager',
      email: null,
      kind: 'adult' as const,
      isMinor: false,
      isNamed: true,
    },
    {
      id: PREVIEW.guestGuestId,
      householdId: PREVIEW.householdId,
      firstName: 'Preview',
      lastName: 'Guest',
      email: null,
      kind: 'adult' as const,
      isMinor: false,
      isNamed: true,
    },
    {
      id: PREVIEW.partyGuestId,
      householdId: PREVIEW.householdId,
      firstName: 'Preview',
      lastName: 'Party',
      email: null,
      kind: 'adult' as const,
      isMinor: false,
      isNamed: true,
    },
    {
      id: PREVIEW.plusOneGuestId,
      householdId: PREVIEW.householdId,
      firstName: 'Preview',
      lastName: 'Plus-one',
      email: null,
      kind: 'plus_one' as const,
      isMinor: false,
      isNamed: true,
      plusOneOfGuestId: PREVIEW.managerGuestId,
    },
  ];
  for (const g of previewGuests) {
    await db.insert(guests).values({ ...g, createdAt: now, updatedAt: now }).onConflictDoNothing();
  }

  await db
    .insert(invitations)
    .values({
      id: PREVIEW.invitationId,
      householdId: PREVIEW.householdId,
      tokenHash: seedId('PREVIEWHASH'),
      tokenPrefix: 'PREV',
      status: 'issued',
      eventKeys: [...ALL_EVENTS],
      plusOneAllowance: 1,
      childrenAllowance: 0,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      issuedBy: { kind: 'system', component: 'preview-personas' },
    })
    .onConflictDoNothing();

  const E = SEED_EVENT_IDS;
  const present = new Set((await db.select({ id: events.id }).from(events).where(inArray(events.id, Object.values(E)))).map((r) => r.id));
  if (present.size === 0) return;

  const entitlements: { id: string; guestId: string; eventId: string; plusOnePolicy: 'none' | 'named' | 'unnamed' }[] = [
    ...[PREVIEW.managerGuestId, PREVIEW.guestGuestId, PREVIEW.partyGuestId].flatMap((guestId, i) =>
      [E.ceremony, E.cocktailHour, E.reception].map((eventId, j) => ({
        id: seedId(`PREVENT${i}${j}`),
        guestId,
        eventId,
        plusOnePolicy: 'none' as const,
      })),
    ),
    { id: seedId('PREVENTP1R'), guestId: PREVIEW.plusOneGuestId, eventId: E.reception, plusOnePolicy: 'none' as const },
  ];
  for (const en of entitlements) {
    if (!present.has(en.eventId)) continue;
    await db.insert(eventEntitlements).values({ ...en, createdAt: now }).onConflictDoNothing();
  }
}

/** Whether preview persona rows exist (for capability status). */
export async function previewPersonasReady(db: Db): Promise<boolean> {
  const row = await db.select({ id: guests.id }).from(guests).where(eq(guests.id, PREVIEW.guestGuestId)).limit(1);
  return row.length > 0;
}

/** Entitlements an admin preview should never persist mutations for — always read-only in authorize. */
export const PREVIEW_BLOCKED_ENTITLEMENTS: readonly Entitlement[] = [];
