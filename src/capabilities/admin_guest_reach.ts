import { desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { guestContacts, guests, guestSheetCopies, households } from '@/db/schema';
import { guestReach } from '@/domain/guests/reach';
import { isPreviewPersonaHouseholdId } from '@/domain/identity/preview-personas';
import { appServices } from './context';
import { adminOf } from './identity/shared';

const output = z.object({
  unreachable: z.array(z.object({ id: z.string(), name: z.string(), people: z.number().int(), priority: z.number().int().nullable(), guestOf: z.string().nullable() })),
  households: z.number().int(),
  peopleWithout: z.number().int(),
});
export type GuestReachView = z.infer<typeof output>;

/**
 * Households that cannot sign in because no grown-up in them has an email or phone on file
 * (src/domain/guests/reach.ts), most-wanted first by the planning sheet's priority. Names and
 * counts only: never a contact detail. Admin only and never offered to the concierge or WebMCP.
 */
export const adminGuestReach = defineCapability<Record<string, never> | undefined, GuestReachView>({
  auth: 'admin',
  requires: ['admin_guest_ops'],
  exposure: { ui: true, ai: false, webmcp: false },
  name: 'admin_guest_reach',
  title: 'Admin: households with no email or phone',
  description: 'Admin only. Households in which no grown-up has an email address or phone number on file, so nobody in them can sign in, ordered by the planning sheet priority. Names and counts only.',
  kind: 'read',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  input: z.object({}).optional(),
  output,
  async handler(ctx) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const [hh, people, contacts, [latest]] = await Promise.all([
      db.select({ id: households.id, name: households.name, sheetLabel: households.sheetLabel }).from(households),
      db.select({ id: guests.id, householdId: guests.householdId, kind: guests.kind, isMinor: guests.isMinor, isNamed: guests.isNamed, email: guests.email, phone: guests.phone, mergedIntoGuestId: guests.mergedIntoGuestId }).from(guests).where(isNull(guests.mergedIntoGuestId)),
      db.select({ guestId: guestContacts.guestId }).from(guestContacts),
      db.select({ rows: guestSheetCopies.rows }).from(guestSheetCopies).orderBy(desc(guestSheetCopies.uploadedAt)).limit(1),
    ]);
    // The preview household is the synthetic one administrators view roles as: nobody to invite.
    const real = hh.filter((h) => !isPreviewPersonaHouseholdId(h.id));
    const data = guestReach(real, people, new Set(contacts.map((c) => c.guestId)), latest?.rows ?? []);
    return ok({ data, sources: [] });
  },
});
