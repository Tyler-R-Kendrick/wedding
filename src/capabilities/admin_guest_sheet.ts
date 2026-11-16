import { desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guests, guestSheetCopies, households } from '@/db/schema';
import { parseGuestSheetText } from '@/domain/guests/sheet';
import { diffSheetCopies, reconcileSheet, sheetKey, type SiteHousehold } from '@/domain/guests/sheet-reconcile';
import { totalsOf } from '@/domain/guests/sheet-totals';
import { upsertHousehold } from '@/domain/households/repo';
import { isPreviewPersonaHouseholdId } from '@/domain/identity/preview-personas';
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
const counts = z.object({ adults: z.number().int(), kids: z.number().int(), plusOnes: z.number().int() });
const changesSchema = z.object({
  added: z.array(z.object({ label: z.string(), people: z.number().int() })),
  removed: z.array(z.object({ label: z.string(), people: z.number().int() })),
  changed: z.array(z.object({ label: z.string(), before: counts, after: counts })),
});
const summarySchema = z.object({ lines: z.number().int(), matched: z.number().int(), differing: z.number().int(), onlyOnSheet: z.number().int(), onlyOnSite: z.number().int(), sheetPeople: z.number().int(), sitePeople: z.number().int() });
const uploadOutput = z.object({
  dryRun: z.boolean(),
  lines: z.number().int(),
  people: z.number().int(),
  withheldColumns: z.array(z.string()),
  missingColumns: z.array(z.string()),
  /** What this copy changes against the one saved before it; null when it is the first. */
  changes: changesSchema.nullable(),
  /** How this copy stands against the site's guest list. */
  site: summarySchema,
});

/** Every household on the site with its head counts, as the reconciliation reads them. */
async function siteHouseholds(db: Db): Promise<SiteHousehold[]> {
  const [rows, members] = await Promise.all([
    db.select({ id: households.id, name: households.name, sheetLabel: households.sheetLabel }).from(households),
    db.select({ householdId: guests.householdId, kind: guests.kind }).from(guests).where(isNull(guests.mergedIntoGuestId)),
  ]);
  // The preview household is the synthetic one administrators view roles as: not an invitation, so
  // not something the sheet should be expected to list.
  const byId = new Map<string, SiteHousehold>(rows.filter((h) => !isPreviewPersonaHouseholdId(h.id)).map((h) => [h.id, { ...h, adults: 0, kids: 0, plusOnes: 0 }]));
  for (const m of members) {
    const h = byId.get(m.householdId);
    if (!h) continue;
    if (m.kind === 'child') h.kids += 1;
    else if (m.kind === 'plus_one') h.plusOnes += 1;
    else h.adults += 1;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const latestCopies = (db: Db, n: number) => db.select().from(guestSheetCopies).orderBy(desc(guestSheetCopies.uploadedAt)).limit(n);

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
    const { db } = appServices(ctx);
    const [[previous], site] = await Promise.all([latestCopies(db, 1), siteHouseholds(db)]);
    const summary = {
      dryRun: !!i.dryRun,
      lines: parsed.rows.length,
      people: totals.people,
      withheldColumns: parsed.withheldColumns,
      missingColumns: parsed.missingColumns,
      changes: previous ? diffSheetCopies(previous.rows, parsed.rows) : null,
      site: reconcileSheet(parsed.rows, site).summary,
    };
    if (i.dryRun) return ok({ data: summary, sources: [] });
    const id = newId();
    await db.insert(guestSheetCopies).values({ id, rows: parsed.rows, withheldColumns: parsed.withheldColumns, missingColumns: parsed.missingColumns, source: i.source || null, uploadedBy: guard.value.adminId, uploadedAt: ctx.now });
    await ctx.audit.record({ actor: actorOf(ctx), action: 'guest.imported', target: { type: 'guest_sheet_copy', id }, outcome: 'success', requestId: ctx.requestId, metadata: { lines: summary.lines, people: summary.people } });
    return ok({ data: summary, sources: [] });
  },
});


const matchSchema = z.object({ sheetRow: z.number().int(), label: z.string(), sheet: counts, household: z.object({ id: z.string(), name: z.string() }), site: counts, how: z.enum(['linked', 'name']), differs: z.boolean() });
const syncOutput = z.object({
  /** The newest copy, or null when the sheet has never been copied in. */
  copy: z.object({ uploadedAt: z.string(), source: z.string().nullable(), lines: z.number().int(), people: z.number().int() }).nullable(),
  summary: summarySchema.nullable(),
  matched: z.array(matchSchema),
  onlyOnSheet: z.array(z.object({ sheetRow: z.number().int(), label: z.string(), sheet: counts, suggestion: z.object({ id: z.string(), name: z.string() }).nullable() })),
  onlyOnSite: z.array(z.object({ id: z.string(), name: z.string(), site: counts })),
  /** What the newest copy changed against the one before it. */
  changes: changesSchema.nullable(),
  previousAt: z.string().nullable(),
});
export type GuestSheetSyncView = z.infer<typeof syncOutput>;

/**
 * The planning sheet set beside the site's guest list (src/domain/guests/sheet-reconcile): the lines
 * that are households here, the lines that are not here yet, the households the sheet does not
 * mention, and where the adult and child counts disagree. Reads only; it is the list of what is
 * left to do after a sync, not the doing of it.
 */
export const adminGuestSheetSync = defineCapability<Record<string, never> | undefined, GuestSheetSyncView>({
  ...ADMIN_ONLY,
  name: 'admin_guest_sheet_sync',
  title: 'Admin: the planning sheet against the guest list',
  description: 'Admin only. Compares the newest copy of the planning sheet with the households on the site: matched lines and whether their adult and child counts agree, lines not on the site (with a suggested household when a name is close), households the sheet does not mention, and what the newest copy changed against the previous one.',
  kind: 'read',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  input: z.object({}).optional(),
  output: syncOutput,
  maxOutputChars: 200_000,
  async handler(ctx) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const [[latest, previous], site] = await Promise.all([latestCopies(db, 2), siteHouseholds(db)]);
    if (!latest) return ok({ data: { copy: null, summary: null, matched: [], onlyOnSheet: [], onlyOnSite: [], changes: null, previousAt: null }, sources: [] });
    const sync = reconcileSheet(latest.rows, site);
    return ok({
      data: {
        copy: { uploadedAt: latest.uploadedAt.toISOString(), source: latest.source, lines: latest.rows.length, people: totalsOf(latest.rows).people },
        summary: sync.summary,
        matched: sync.matched,
        onlyOnSheet: sync.onlyOnSheet,
        onlyOnSite: sync.onlyOnSite,
        changes: previous ? diffSheetCopies(previous.rows, latest.rows) : null,
        previousAt: previous ? previous.uploadedAt.toISOString() : null,
      },
      sources: [],
    });
  },
});

const linkInput = z.object({ householdId: z.string().min(1).max(64), label: z.string().trim().min(1).max(200).nullable() });

/**
 * Says which line of the sheet a household is ("Mom/Dad Fitz" is The Fitzgerald Family), or takes
 * that back with `label: null`. The sheet and the site name households their own ways; the link is
 * what keeps them matched through the next sync.
 */
export const adminLinkSheetLine = defineCapability<z.infer<typeof linkInput>, { householdId: string; label: string | null }>({
  ...ADMIN_ONLY,
  name: 'admin_link_sheet_line',
  title: 'Admin: link a household to its line on the planning sheet',
  description: 'Admin only. Records which planning-sheet line a household is, by the line’s name as written on the sheet, or clears the link with a null label. Changes nothing else about the household.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  input: linkInput,
  output: z.object({ householdId: z.string(), label: z.string().nullable() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    if (i.label) {
      // One line, one household: a second household claiming the same line would make the next sync a coin toss.
      const key = sheetKey(i.label);
      const others = await db.select({ id: households.id, name: households.name, sheetLabel: households.sheetLabel }).from(households);
      const taken = others.find((h) => h.id !== i.householdId && h.sheetLabel && sheetKey(h.sheetLabel) === key);
      if (taken) return err(new CapabilityError('conflict', `That line is already linked to ${taken.name}. Unlink it there first.`));
    }
    const [row] = await db.update(households).set({ sheetLabel: i.label, updatedAt: ctx.now }).where(eq(households.id, i.householdId)).returning({ id: households.id });
    if (!row) return err(new CapabilityError('not_found', 'That household does not exist.'));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { sheetLink: i.label ? 'set' : 'cleared' } });
    return ok({ data: { householdId: row.id, label: i.label }, sources: [] });
  },
});

const adoptInput = z.object({ label: z.string().trim().min(1).max(200) });

/**
 * Adds a sheet line to the site as a household, named as the sheet names it and linked to that
 * line. The sheet counts heads and names nobody, so the household starts empty: the people in it
 * are added on the Guests screen, where an invitation needs a name.
 */
export const adminAddHouseholdFromSheet = defineCapability<z.infer<typeof adoptInput>, { householdId: string; name: string; created: boolean }>({
  ...ADMIN_ONLY,
  name: 'admin_add_household_from_sheet',
  title: 'Admin: add a planning-sheet line as a household',
  description: 'Admin only. Creates an empty household named after a planning-sheet line and links it to that line. If a household already answers to that line (by link or by name) it is linked and returned instead; nothing is duplicated. No guests are created.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  input: adoptInput,
  output: z.object({ householdId: z.string(), name: z.string(), created: z.boolean() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const key = sheetKey(i.label);
    const all = await db.select({ id: households.id, name: households.name, sheetLabel: households.sheetLabel }).from(households);
    const existing = all.find((h) => (h.sheetLabel && sheetKey(h.sheetLabel) === key) || sheetKey(h.name) === key);
    if (existing) {
      if (!existing.sheetLabel) await db.update(households).set({ sheetLabel: i.label, updatedAt: ctx.now }).where(eq(households.id, existing.id));
      return ok({ data: { householdId: existing.id, name: existing.name, created: false }, sources: [] });
    }
    const made = await upsertHousehold(db, { name: i.label });
    if (!made.ok) return err(made.error);
    await db.update(households).set({ sheetLabel: i.label }).where(eq(households.id, made.value.id));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: made.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { created: true, from: 'planning_sheet' } });
    return ok({ data: { householdId: made.value.id, name: made.value.name, created: true }, sources: [] });
  },
});
