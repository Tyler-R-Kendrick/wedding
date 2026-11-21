import type { GuestRow } from '@/db/schema';
import type { GuestSheetRow } from './sheet';
import { sheetKey } from './sheet-reconcile';

/**
 * Households nobody on the site can sign in for: not one grown-up in them has an email or a phone
 * number on their record. Sign-in is by a code sent to one or the other (or a social account whose
 * email is on file), so until someone in the household has one, the whole household waits on the
 * couple. These are the people to chase first, most-wanted (the sheet's priority) first.
 */
export interface UnreachableHousehold {
  id: string;
  name: string;
  /** Named grown-ups in it, none of whom has an email or phone. */
  people: number;
  /** The sheet line's invite tier (1 = must invite), when the household is linked to a line. */
  priority: number | null;
  /** "Bride", "Groom", "Both", as the sheet says. */
  guestOf: string | null;
}

export interface GuestReach {
  /** Households with nobody to send a code to, highest priority first. */
  unreachable: UnreachableHousehold[];
  households: number;
  /** Named grown-ups anywhere with no email or phone of their own (their household may still be reachable through someone else). */
  peopleWithout: number;
}

type Household = { id: string; name: string; sheetLabel: string | null };
type Person = Pick<GuestRow, 'id' | 'householdId' | 'kind' | 'isMinor' | 'isNamed' | 'email' | 'phone' | 'mergedIntoGuestId'>;

export function guestReach(households: readonly Household[], people: readonly Person[], contactGuestIds: ReadonlySet<string>, sheetRows: readonly Pick<GuestSheetRow, 'name' | 'priority' | 'guestOf'>[] = []): GuestReach {
  const line = new Map(sheetRows.map((r) => [sheetKey(r.name), r]));
  const grownUps = people.filter((g) => !g.mergedIntoGuestId && g.kind !== 'child' && !g.isMinor);
  const has = (g: Person) => !!g.email || !!g.phone || contactGuestIds.has(g.id);
  const unreachable: UnreachableHousehold[] = [];
  let counted = 0;
  for (const h of households) {
    const members = grownUps.filter((g) => g.householdId === h.id);
    if (!members.length) continue; // an empty household is the sheet screen's to report, not a sign-in problem
    counted += 1;
    if (members.some(has)) continue;
    const row = line.get(sheetKey(h.sheetLabel ?? h.name)) ?? (h.sheetLabel ? line.get(sheetKey(h.name)) : undefined);
    unreachable.push({ id: h.id, name: h.name, people: members.filter((g) => g.isNamed).length, priority: row?.priority ?? null, guestOf: row?.guestOf ?? null });
  }
  unreachable.sort((a, b) => (a.priority ?? Number.POSITIVE_INFINITY) - (b.priority ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));
  return { unreachable, households: counted, peopleWithout: grownUps.filter((g) => g.isNamed && !has(g)).length };
}
