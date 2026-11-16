import { eq, isNull } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import type { Db } from '@/db/client';
import { guestAccessBindings, guests, invitations } from '@/db/schema';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { normalizeNamePart } from '@/domain/identity/name-match';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { issueInvitation } from '@/domain/invitations/repo';

/**
 * The wedding planner's guest sign-in.
 *
 * She is not on the couple's planning sheet, and she has to be able to see the site as a guest
 * does. This keeps that true on every production deploy, whatever a guest-list upload did: she has
 * a guest record, the names she may be signed in under online are on it, and her household has an
 * invitation marked as sent (which is what lets a guest sign in with Google or Facebook by name).
 * It only adds what is missing. An existing record of hers is never renamed, moved or re-issued.
 *
 * Her name and her business are on the public site already (src/domain/contact/copy.ts); nothing
 * else about her is kept here.
 */
export const PLANNER_GUEST = {
  firstName: 'Michelle Elaine',
  lastName: 'Sunder',
  /** Her business, which a Google or Facebook profile may be named for instead of her. */
  alternateNames: ['Bustle & Lace'],
  household: 'Michelle Sunder',
} as const;

export interface PlannerGuestStatus {
  /** Guest records that are hers. More than one means a name sign-in cannot tell them apart. */
  records: number;
  invitationSent: boolean;
  hasSignedIn: boolean;
  /** What this run added, if anything. */
  added: ('record' | 'names' | 'invitation')[];
}

const isHers = (g: { firstName: string; lastName: string }) => normalizeNamePart(g.lastName) === normalizeNamePart(PLANNER_GUEST.lastName) && normalizeNamePart(g.firstName).split(' ')[0] === normalizeNamePart(PLANNER_GUEST.firstName).split(' ')[0];

async function usableSentInvitation(db: Db, householdId: string, now: Date): Promise<boolean> {
  const rows = await db.select().from(invitations).where(eq(invitations.householdId, householdId));
  return rows.some((i) => i.sentAt && ['active', 'claimed'].includes(invitationLifecycle(i, now)));
}

export async function plannerGuestStatus(db: Db, now: Date = new Date()): Promise<Omit<PlannerGuestStatus, 'added'>> {
  const hers = (await db.select().from(guests).where(isNull(guests.mergedIntoGuestId))).filter(isHers);
  let invitationSent = false;
  let hasSignedIn = false;
  for (const g of hers) {
    if (await usableSentInvitation(db, g.householdId, now)) invitationSent = true;
    const bound = await db.select({ revokedAt: guestAccessBindings.revokedAt }).from(guestAccessBindings).where(eq(guestAccessBindings.guestId, g.id));
    if (bound.some((b) => !b.revokedAt)) hasSignedIn = true;
  }
  return { records: hers.length, invitationSent, hasSignedIn };
}

export async function ensurePlannerGuest(db: Db, deps: { audit: AuditSink; now?: Date }): Promise<PlannerGuestStatus> {
  const now = deps.now ?? new Date();
  const added: PlannerGuestStatus['added'] = [];
  let hers = (await db.select().from(guests).where(isNull(guests.mergedIntoGuestId))).filter(isHers);
  // Two records are the couple's to sort out (/admin/guests, Merge): adding to either would be a guess.
  if (hers.length > 1) return { ...(await plannerGuestStatus(db, now)), added };
  if (hers.length === 0) {
    const home = await upsertHousehold(db, { name: PLANNER_GUEST.household });
    if (!home.ok) throw new Error(home.error.message);
    const made = await upsertGuest(db, { householdId: home.value.id, firstName: PLANNER_GUEST.firstName, lastName: PLANNER_GUEST.lastName, alternateNames: [...PLANNER_GUEST.alternateNames] });
    if (!made.ok) throw new Error(made.error.message);
    hers = [made.value];
    added.push('record');
  }
  const her = hers[0]!;
  const have = new Set(her.alternateNames.map((n) => normalizeNamePart(n)));
  const missing = PLANNER_GUEST.alternateNames.filter((n) => !have.has(normalizeNamePart(n)));
  if (missing.length) {
    const named = await upsertGuest(db, { id: her.id, householdId: her.householdId, firstName: her.firstName, alternateNames: [...her.alternateNames, ...missing] });
    if (!named.ok) throw new Error(named.error.message);
    if (!added.includes('record')) added.push('names');
  }
  if (!(await usableSentInvitation(db, her.householdId, now))) {
    const issued = await issueInvitation(db, { householdId: her.householdId, eventKeys: [], issuedBy: { kind: 'system', component: 'planner_guest' }, requestId: 'deploy:planner-guest', audit: deps.audit, now });
    if (!issued.ok) throw new Error(issued.error.message);
    await db.update(invitations).set({ sentAt: now }).where(eq(invitations.id, issued.value.invitation.id));
    added.push('invitation');
  }
  return { ...(await plannerGuestStatus(db, now)), added };
}
