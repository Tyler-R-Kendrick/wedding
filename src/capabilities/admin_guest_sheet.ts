import { desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guests, guestSheetCopies, households } from '@/db/schema';
import { guestRows, sheetSyncLines, syncGuestsFromSheet } from '@/domain/guests/sheet-sync';
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
  /** What saving did to the guest records (absent on a dry run): counts only. */
  guests: z.object({ added: z.number().int(), alreadyThere: z.number().int(), completed: z.number().int(), counted: z.number().int(), cannotBeFoundByName: z.number().int(), skippedLines: z.number().int() }).optional(),
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
 *
 * Saving also makes the guest records agree with the sheet (src/domain/guests/sheet-sync.ts): each
 * person a line names becomes a guest unless they already are one, so that either person on a line
 * can sign in under their own name. It only adds and completes; nobody is removed or changed. The
 * contact columns it reads are Email and Phone, which become that guest's sign-in details.
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
    // The lines that are guests, without the sheet's own tallies under them: what the sync reads too.
    const lines = guestRows(parsed.rows);
    const summary = {
      dryRun: !!i.dryRun,
      lines: parsed.rows.length,
      people: totals.people,
      withheldColumns: parsed.withheldColumns,
      missingColumns: parsed.missingColumns,
      changes: previous ? diffSheetCopies(guestRows(previous.rows), lines) : null,
      site: reconcileSheet(lines, site).summary,
    };
    if (i.dryRun) return ok({ data: summary, sources: [] });
    const id = newId();
    // The copy and the guest records change together, or not at all.
    const synced = await db.transaction(async (tx) => {
      const t = tx as unknown as typeof db;
      await t.insert(guestSheetCopies).values({ id, rows: parsed.rows, withheldColumns: parsed.withheldColumns, missingColumns: parsed.missingColumns, source: i.source || null, uploadedBy: guard.value.adminId, uploadedAt: ctx.now });
      // Which household the sync gave each line, so the link outlives a rename on either side.
      const homes = new Map<string, string>();
      const result = await syncGuestsFromSheet(t, sheetSyncLines(i.text).lines, { onHousehold: (line, householdId) => homes.set(householdId, line.name) });
      const linked = new Map((await t.select({ id: households.id, sheetLabel: households.sheetLabel }).from(households)).map((h) => [h.id, h.sheetLabel]));
      const taken = new Set([...linked.values()].flatMap((label) => (label ? [sheetKey(label)] : [])));
      for (const [householdId, label] of homes) {
        // A link a person saved stands, and one line is one household's.
        if (linked.get(householdId) || taken.has(sheetKey(label))) continue;
        await t.update(households).set({ sheetLabel: label }).where(eq(households.id, householdId));
        taken.add(sheetKey(label));
      }
      return result;
    });
    const guestsSummary = {
      added: synced.guests.created,
      alreadyThere: synced.guests.found,
      completed: synced.guests.completed,
      counted: synced.guests.unnamedCreated,
      cannotBeFoundByName: Object.values(synced.notes).reduce((a, b) => a + (b ?? 0), 0),
      skippedLines: synced.skipped.length,
    };
    await ctx.audit.record({ actor: actorOf(ctx), action: 'guest.imported', target: { type: 'guest_sheet_copy', id }, outcome: 'success', requestId: ctx.requestId, metadata: { lines: summary.lines, people: summary.people, ...guestsSummary, householdsAdded: synced.households.created, emailsAdded: synced.emailsAdded, phonesAdded: synced.phonesAdded, foundElsewhere: synced.foundElsewhere } });
    return ok({ data: { ...summary, guests: guestsSummary }, sources: [] });
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
 * mention, and where the head counts disagree. Reads only; it is the list of what is
 * left to do after a sync, not the doing of it.
 */
export const adminGuestSheetSync = defineCapability<Record<string, never> | undefined, GuestSheetSyncView>({
  ...ADMIN_ONLY,
  name: 'admin_guest_sheet_sync',
  title: 'Admin: the planning sheet against the guest list',
  description: 'Admin only. Compares the newest copy of the planning sheet with the households on the site: matched lines and whether their head counts agree (grown-ups together, and children), lines not on the site (with a suggested household when a name is close), households the sheet does not mention, and what the newest copy changed against the previous one.',
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
    const lines = guestRows(latest.rows);
    const sync = reconcileSheet(lines, site);
    return ok({
      data: {
        copy: { uploadedAt: latest.uploadedAt.toISOString(), source: latest.source, lines: lines.length, people: totalsOf(latest.rows).people },
        summary: sync.summary,
        matched: sync.matched,
        onlyOnSheet: sync.onlyOnSheet,
        onlyOnSite: sync.onlyOnSite,
        changes: previous ? diffSheetCopies(guestRows(previous.rows), lines) : null,
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
 * line. It is for a line the upload's own sync left alone, so the household starts empty: the people in it
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
    // The household that answers to this line: the one linked to it, else one with the same name
    // that is not already another line's. A namesake linked elsewhere is a different household
    // ("Smith" the line beside "Smith" the household that is "Bob & Jane" on the sheet).
    const existing = all.find((h) => h.sheetLabel && sheetKey(h.sheetLabel) === key) ?? all.find((h) => !h.sheetLabel && sheetKey(h.name) === key);
    if (existing) {
      if (!existing.sheetLabel) {
        await db.update(households).set({ sheetLabel: i.label, updatedAt: ctx.now }).where(eq(households.id, existing.id));
        await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: existing.id }, outcome: 'success', requestId: ctx.requestId, metadata: { sheetLink: 'set', from: 'planning_sheet' } });
      }
      return ok({ data: { householdId: existing.id, name: existing.name, created: false }, sources: [] });
    }
    const made = await upsertHousehold(db, { name: i.label });
    if (!made.ok) return err(made.error);
    await db.update(households).set({ sheetLabel: i.label, updatedAt: ctx.now }).where(eq(households.id, made.value.id));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: made.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { created: true, from: 'planning_sheet' } });
    return ok({ data: { householdId: made.value.id, name: made.value.name, created: true }, sources: [] });
  },
});
