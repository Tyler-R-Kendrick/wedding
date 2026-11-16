import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { newId, type AuditEventId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { guests, households, invitations, type InvitationRow } from '@/db/schema';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { issueInvitation } from './repo';

/**
 * Invitations, a group of households at a time.
 *
 * The couple gather households into one group on /admin/invitations (`households.in_bulk_group`,
 * saved, shared between them) and then act on the group: make its links, mark it as sent, mark it
 * as not sent. "Sent" is what lets a household's guests sign in with Google or Facebook under the
 * name on the guest list (src/domain/identity/social/complete.ts), so nothing here marks anything
 * as sent that was not asked for by name, and a household with no link is skipped and counted,
 * never given one quietly.
 */

/** A link that still works: the only kind that counts as the household's invitation. */
const usable = (i: Pick<InvitationRow, 'status' | 'expiresAt'>, now: Date) => {
  const life = invitationLifecycle(i, now);
  return life === 'active' || life === 'claimed';
};

export interface HouseholdInvitationState {
  id: string;
  name: string;
  /** Named people in the household. */
  people: number;
  inGroup: boolean;
  /** `none`: no link that works. `claimed`: someone has opened it and claimed their place. */
  link: 'none' | 'active' | 'claimed';
  /** When it was marked as sent, if it is. */
  sentAt: Date | null;
}

/** Every household, with where its invitation stands. */
export async function listHouseholdInvitationStates(db: Db, now: Date = new Date()): Promise<HouseholdInvitationState[]> {
  const homes = await db.select({ id: households.id, name: households.name, inGroup: households.inBulkGroup }).from(households);
  const members = await db.select({ householdId: guests.householdId }).from(guests).where(and(isNull(guests.mergedIntoGuestId), eq(guests.isNamed, true)));
  const people = new Map<string, number>();
  for (const m of members) people.set(m.householdId, (people.get(m.householdId) ?? 0) + 1);
  const links = await db.select({ householdId: invitations.householdId, status: invitations.status, expiresAt: invitations.expiresAt, sentAt: invitations.sentAt }).from(invitations);
  const byHome = new Map<string, typeof links>();
  for (const l of links) if (usable(l, now)) byHome.set(l.householdId, [...(byHome.get(l.householdId) ?? []), l]);
  return homes
    .map((h) => {
      const mine = byHome.get(h.id) ?? [];
      const sent = mine.map((l) => l.sentAt).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
      return {
        id: h.id,
        name: h.name,
        people: people.get(h.id) ?? 0,
        inGroup: h.inGroup,
        link: mine.length === 0 ? ('none' as const) : mine.some((l) => l.status === 'claimed') ? ('claimed' as const) : ('active' as const),
        sentAt: sent[0] ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** Puts households in the bulk group, or takes them out. Says how many changed. */
export async function setBulkGroup(db: Db, householdIds: readonly string[], inGroup: boolean, now: Date = new Date()): Promise<number> {
  if (!householdIds.length) return 0;
  const changed = await db
    .update(households)
    .set({ inBulkGroup: inGroup, updatedAt: now })
    .where(and(inArray(households.id, [...householdIds]), eq(households.inBulkGroup, !inGroup)))
    .returning({ id: households.id });
  return changed.length;
}

/**
 * An audit sink that holds what it is told until the transaction around it has committed. The real
 * sink writes on its own connection: inside a transaction it would wait on that transaction (and,
 * on the single-connection local database, for ever), and would record acts that then rolled back.
 */
function heldAudit(real: AuditSink): { sink: AuditSink; flush: () => Promise<void> } {
  const held: Parameters<AuditSink['record']>[0][] = [];
  return {
    // The id handed back is a placeholder nobody here reads: the real one is given when it is written.
    sink: {
      record: async (event) => {
        held.push(event);
        return newId<AuditEventId>();
      },
    },
    flush: async () => {
      for (const event of held.splice(0)) await real.record(event);
    },
  };
}

interface Acting {
  actor: PrincipalRef;
  requestId: string;
  audit: AuditSink;
  now?: Date;
}

export interface MarkSentResult {
  /** Households whose state changed. */
  changed: number;
  /** Households already as asked. */
  already: number;
  /** Households with no link that works: nothing to mark. Their names, for the screen to say. */
  noLink: string[];
}

/**
 * Marks the households' invitations as sent, or as not sent. Only links that still work are
 * touched, and only for the households named. One transaction: all of them, or none.
 */
export async function markHouseholdsSent(db: Db, input: Acting & { householdIds: readonly string[]; sent: boolean }): Promise<MarkSentResult> {
  const now = input.now ?? new Date();
  const ids = [...new Set(input.householdIds)];
  const result: MarkSentResult = { changed: 0, already: 0, noLink: [] };
  if (!ids.length) return result;
  const audit = heldAudit(input.audit);
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const homes = await t.select({ id: households.id, name: households.name }).from(households).where(inArray(households.id, ids));
    const links = (await t.select().from(invitations).where(inArray(invitations.householdId, ids))).filter((l) => usable(l, now));
    for (const home of homes) {
      const mine = links.filter((l) => l.householdId === home.id);
      if (!mine.length) {
        result.noLink.push(home.name);
        continue;
      }
      const isSent = mine.some((l) => l.sentAt !== null);
      if (isSent === input.sent) {
        result.already += 1;
        continue;
      }
      const touch = input.sent ? mine : mine.filter((l) => l.sentAt !== null);
      await t.update(invitations).set({ sentAt: input.sent ? now : null }).where(inArray(invitations.id, touch.map((l) => l.id)));
      for (const l of touch) {
        await audit.sink.record({ actor: input.actor, action: 'invitation.issued', target: { type: 'invitation', id: l.id }, outcome: 'success', requestId: input.requestId, metadata: { householdId: home.id, markedSent: input.sent, bulk: true } });
      }
      result.changed += 1;
    }
  });
  await audit.flush();
  result.noLink.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return result;
}

export interface IssuedForHousehold {
  householdId: string;
  householdName: string;
  invitation: InvitationRow;
  /** Shown once by the caller and never stored. */
  token: string;
}

/**
 * Makes a link for each household that has none that works. A household that already has one is
 * left alone and counted: replacing a link is its own act (it stops the old one working). One
 * transaction: a failure part-way would leave links made whose tokens were never shown.
 */
export async function issueForHouseholds(
  db: Db,
  input: Acting & { householdIds: readonly string[]; eventKeys: string[]; plusOneAllowance: number; childrenAllowance: number },
): Promise<{ issued: IssuedForHousehold[]; hadLink: number }> {
  const now = input.now ?? new Date();
  const ids = [...new Set(input.householdIds)];
  if (!ids.length) return { issued: [], hadLink: 0 };
  const audit = heldAudit(input.audit);
  const done = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const homes = (await t.select({ id: households.id, name: households.name }).from(households).where(inArray(households.id, ids))).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const have = new Set((await t.select().from(invitations).where(inArray(invitations.householdId, ids))).filter((l) => usable(l, now)).map((l) => l.householdId));
    const issued: IssuedForHousehold[] = [];
    for (const home of homes) {
      if (have.has(home.id)) continue;
      const made = await issueInvitation(t, { householdId: home.id, eventKeys: input.eventKeys, plusOneAllowance: input.plusOneAllowance, childrenAllowance: input.childrenAllowance, issuedBy: input.actor, requestId: input.requestId, audit: audit.sink, now });
      if (!made.ok) throw made.error;
      issued.push({ householdId: home.id, householdName: home.name, invitation: made.value.invitation, token: made.value.token });
    }
    return { issued, hadLink: homes.length - issued.length };
  });
  await audit.flush();
  return done;
}
