import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { toCapabilityError } from '@/providers/base';
import { totalsOf } from '@/domain/guests/sheet-totals';
import { appServices } from './context';
import { adminOf } from './identity/shared';

const input = z.object({ fresh: z.boolean().optional() }).optional();

const row = z.object({
  sheetRow: z.number().int(),
  name: z.string(),
  adults: z.number().int(),
  kids: z.number().int(),
  plusOnes: z.number().int(),
  guestOf: z.string().nullable(),
  group: z.string().nullable(),
  priority: z.number().int().nullable(),
  saveTheDateSent: z.string().nullable(),
  inviteSent: z.string().nullable(),
  rsvp: z.string().nullable(),
  table: z.string().nullable(),
  menu: z.string().nullable(),
});

const output = z.object({
  rows: z.array(row),
  totals: z.object({
    households: z.number().int(),
    adults: z.number().int(),
    kids: z.number().int(),
    plusOnes: z.number().int(),
    people: z.number().int(),
    byPriority: z.array(z.object({ priority: z.number().int(), households: z.number().int(), people: z.number().int(), cumulativePeople: z.number().int() })),
  }),
  retrievedAt: z.string(),
  ttlSeconds: z.number().int(),
  stale: z.boolean(),
  sample: z.boolean(),
  sheetUrl: z.string().nullable(),
  withheldColumns: z.array(z.string()),
  missingColumns: z.array(z.string()),
});
export type GuestSheetView = z.infer<typeof output>;

/**
 * The couple's planning sheet, read live (src/providers/guest-sheet). It is the list they edit;
 * this reads it so the console shows the same households and head counts without anyone copying
 * rows across. Read only, admin only, never offered to the concierge or WebMCP: the sheet is a
 * private planning document. Contact details, dietary needs and notes are never read from it.
 */
export const adminGuestSheet = defineCapability<z.infer<typeof input>, GuestSheetView>({
  name: 'admin_guest_sheet',
  title: 'Admin: read the planning sheet',
  description: "Admin only. Reads the couple's Google Sheet guest list (households, head counts, side, group, priority, invitation status) live, with totals. Read only. Not offered to the concierge.",
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const sheet = appServices(ctx).providers('guest-sheet');
    const read = await sheet.read({ fresh: i?.fresh === true });
    if (!read.ok) return err(toCapabilityError(read.error));
    const { data, retrievedAt, ttlSeconds } = read.value;
    return ok({
      data: {
        rows: data.rows,
        totals: totalsOf(data.rows),
        retrievedAt,
        ttlSeconds,
        stale: data.stale,
        sample: data.sample,
        sheetUrl: sheet.sheetUrl,
        withheldColumns: data.withheldColumns,
        missingColumns: data.missingColumns,
      },
      sources: [],
    });
  },
});
