import { eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { guestAccessBindings, guests, invitations } from '@/db/schema';
import { normalizeNamePart } from '@/domain/identity/name-match';
import { invitationLifecycle } from '@/domain/identity/tokens';

/**
 * Whether the wedding planner can sign in as a guest.
 *
 * She is not on the couple's planning sheet, and she has to be able to see the site as a guest
 * does. Her guest record is the couple's to keep (/admin/guests), like anyone's: a guest-list
 * upload never removes, renames or moves it (src/domain/guests/sheet-sync.ts only adds), and this
 * says, on every production deploy, whether it is still in place: that she has one record, that
 * her household's invitation is marked sent (which is what lets a guest sign in with Google or
 * Facebook by name), and whether she has signed in.
 *
 * It reports and changes nothing. Her name is on the public site (src/domain/contact/copy.ts), so
 * a record made here with its invitation marked sent would let anyone who read that page sign in
 * under her name before she did; and a record put back on every deploy would undo the couple's
 * own edits. Sign-in under her name works as it does for every guest: by a verified email on her
 * record, or by her name as her Google or Facebook profile gives it, in any of the ways
 * src/domain/identity/name-match.ts allows. A profile named only for her business matches nobody
 * and goes to the couple's review list, where one approval links it.
 */
export const PLANNER_GUEST = { firstName: 'Michelle Elaine', lastName: 'Sunder' } as const;

export interface PlannerGuestStatus {
  /** Guest records that are hers. None: she cannot sign in. More than one: a name sign-in cannot tell them apart. */
  records: number;
  invitationSent: boolean;
  hasSignedIn: boolean;
}

const isHers = (g: { firstName: string; lastName: string }) => normalizeNamePart(g.lastName) === normalizeNamePart(PLANNER_GUEST.lastName) && normalizeNamePart(g.firstName).split(' ')[0] === normalizeNamePart(PLANNER_GUEST.firstName).split(' ')[0];

export async function plannerGuestStatus(db: Db, now: Date = new Date()): Promise<PlannerGuestStatus> {
  const hers = (await db.select().from(guests).where(isNull(guests.mergedIntoGuestId))).filter(isHers);
  let invitationSent = false;
  let hasSignedIn = false;
  for (const g of hers) {
    const sent = await db.select().from(invitations).where(eq(invitations.householdId, g.householdId));
    if (sent.some((i) => i.sentAt && ['active', 'claimed'].includes(invitationLifecycle(i, now)))) invitationSent = true;
    const bound = await db.select({ revokedAt: guestAccessBindings.revokedAt }).from(guestAccessBindings).where(eq(guestAccessBindings.guestId, g.id));
    if (bound.some((b) => !b.revokedAt)) hasSignedIn = true;
  }
  return { records: hers.length, invitationSent, hasSignedIn };
}
