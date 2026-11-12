import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import { guestSheetCopies } from '@/db/schema';
import { parseGuestSheetText } from '@/domain/guests/sheet';
import { totalsOf } from '@/domain/guests/sheet-totals';
import { appServices } from './context';
import { actorOf, adminOf } from './identity/shared';

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

const copy = z.object({
  rows: z.array(row),
  totals: z.object({
    households: z.number().int(),
    adults: z.number().int(),
    kids: z.number().int(),
    plusOnes: z.number().int(),
    people: z.number().int(),
    byPriority: z.array(z.object({ priority: z.number().int(), households: z.number().int(), people: z.number().int(), cumulativePeople: z.number().int() })),
  }),
  uploadedAt: z.string(),
  source: z.string().nullable(),
  withheldColumns: z.array(z.string()),
  missingColumns: z.array(z.string()),
});

const output = z.object({ copy: copy.nullable() });
export type GuestSheetView = z.infer<typeof output>;
export type GuestSheetCopyView = z.infer<typeof copy>;

const ADMIN_ONLY = { auth: 'admin', requires: ['admin_guest_ops'], exposure: { ui: true, ai: false, webmcp: false } } as const;

/**
 * The couple's planning sheet as last copied into the site (src/domain/guests/sheet). The sheet is
 * where the list is kept; the console shows the latest copy beside the site's own guest records,
 * so nobody re-types rows. Admin only and never offered to the concierge or WebMCP: it is a private
 * planning document. Contact details, dietary needs and notes are never stored from it.
 */
export const adminGuestSheet = defineCapability<Record<string, never> | undefined, GuestSheetView>({
  ...ADMIN_ONLY,
  name: 'admin_guest_sheet',
  title: 'Admin: the planning sheet',
  description: "Admin only. The couple's planning-sheet guest list (households, head counts, side, group, priority, invitation status) as last copied into the site, with totals. Not offered to the concierge.",
  kind: 'read',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  input: z.object({}).optional(),
  output,
  async handler(ctx) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const [latest] = await db.select().from(guestSheetCopies).orderBy(desc(guestSheetCopies.uploadedAt)).limit(1);
    if (!latest) return ok({ data: { copy: null }, sources: [] });
    return ok({
      data: {
        copy: {
          rows: latest.rows,
          totals: totalsOf(latest.rows),
          uploadedAt: latest.uploadedAt.toISOString(),
          source: latest.source,
          withheldColumns: latest.withheldColumns,
          missingColumns: latest.missingColumns,
        },
      },
      sources: [],
    });
  },
});

const uploadInput = z.object({
  /** The Guests tab as copied out of the sheet (tab-separated), or a CSV export of it. */
  text: z.string().min(1).max(500_000),
  source: z.string().trim().max(120).optional(),
  dryRun: z.boolean().optional(),
});
const uploadOutput = z.object({ dryRun: z.boolean(), lines: z.number().int(), people: z.number().int(), withheldColumns: z.array(z.string()), missingColumns: z.array(z.string()) });

/**
 * Replaces the planning sheet's copy with a fresh one. The pasted text is parsed on the server and
 * only the planning columns are kept; the text itself is never stored or logged. A dry run says
 * what would be saved.
 */
export const adminUploadGuestSheet = defineCapability<z.infer<typeof uploadInput>, z.infer<typeof uploadOutput>>({
  ...ADMIN_ONLY,
  name: 'admin_upload_guest_sheet',
  title: 'Admin: update the planning sheet',
  description: "Admin only. Saves a new copy of the planning sheet's Guests tab (pasted from the sheet, or a CSV export). Only planning columns are kept; contact details, dietary needs and notes are dropped.",
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  input: uploadInput,
  output: uploadOutput,
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const parsed = parseGuestSheetText(i.text);
    if (parsed.rows.length === 0) return err(new CapabilityError('validation', 'No guest lines were found. Paste the whole Guests tab, header row first.'));
    const totals = totalsOf(parsed.rows);
    const summary = { dryRun: !!i.dryRun, lines: parsed.rows.length, people: totals.people, withheldColumns: parsed.withheldColumns, missingColumns: parsed.missingColumns };
    if (i.dryRun) return ok({ data: summary, sources: [] });
    const { db } = appServices(ctx);
    const id = newId();
    await db.insert(guestSheetCopies).values({ id, rows: parsed.rows, withheldColumns: parsed.withheldColumns, missingColumns: parsed.missingColumns, source: i.source || null, uploadedBy: guard.value.adminId, uploadedAt: ctx.now });
    await ctx.audit.record({ actor: actorOf(ctx), action: 'guest.imported', target: { type: 'guest_sheet_copy', id }, outcome: 'success', requestId: ctx.requestId, metadata: { lines: summary.lines, people: summary.people } });
    return ok({ data: summary, sources: [] });
  },
});
