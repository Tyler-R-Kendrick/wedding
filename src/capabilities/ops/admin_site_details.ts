import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { err, ok } from '@/contracts/result';
import { getSiteSettings } from '@/db/repos/site';
import { operationalFields, siteSettings } from '@/db/schema';
import { formatDeadline, formatEventWindow } from '@/domain/events/format';
import { getRsvpSettings, listEvents } from '@/domain/events/repo';
import { formatLongDate } from '@/domain/lifecycle';
import { VENUE_SPACES } from '@/domain/seating/plans';
import { DETAIL_GROUPS, buildSiteDetails } from '@/domain/site-details';
import { DEFAULT_VENUE_BLOCK, VENUE } from '@/domain/travel/facts';
import { getVenueHotel } from '@/domain/travel/hotels';
import { CAA_BLOCK_CHECK_IN, CAA_BLOCK_CHECK_OUT } from '@/domain/travel/stay-copy';
import { toPrincipalRef } from '@/contracts/principal';
import { opsDb } from './_shared';

const shownOn = z.object({ label: z.string(), href: z.string() });
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('here'), input: z.enum(['date', 'datetime', 'text', 'url']), capability: z.string(), base: z.record(z.string(), z.unknown()), field: z.string(), raw: z.string(), optional: z.boolean() }),
  z.object({ kind: z.literal('screen'), href: z.string(), label: z.string() }),
  z.object({ kind: z.literal('code'), where: z.string() }),
]);
const fact = z.object({
  key: z.string(),
  group: z.enum(['day', 'replies', 'schedule', 'stay', 'arrival']),
  label: z.string(),
  value: z.string().nullable(),
  state: z.enum(['set', 'todo', 'differs']),
  shownOn: z.array(shownOn),
  edit,
  copies: z.array(z.object({ where: z.string(), value: z.string(), follows: z.literal(false) })),
});
const output = z.object({
  groups: z.array(z.object({ id: z.string(), label: z.string(), facts: z.array(fact) })),
  counts: z.object({ total: z.number().int(), todo: z.number().int(), differs: z.number().int() }),
});
export type SiteDetailsView = z.infer<typeof output>;

const EDITED_HERE = ['valet.entrance', 'valet.event-rate'] as const;

/**
 * Every fact that shows in more than one place, in one read: what it says, where it shows, how it
 * is changed, and whether a copy in the code disagrees (src/domain/site-details). The screen built
 * on it (/admin/details) is where a date or a detail is changed once.
 */
export const adminSiteDetails = defineCapability<Record<string, never> | undefined, SiteDetailsView>({
  name: 'admin_site_details',
  title: 'Site details',
  description: 'The facts that appear in several places on the site (wedding date, venue name and address, reply-by time, each event’s time, room and dress code, the room block, valet), each with its current value, the pages it shows on, how it is changed, and any copy in the code that says something different. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({}).optional(),
  output,
  maxOutputChars: 60_000,
  async handler(ctx) {
    const db = opsDb(ctx);
    const [site, rsvp, events, hotel, fieldRows] = await Promise.all([getSiteSettings(db), getRsvpSettings(db), listEvents(db), getVenueHotel(db, ctx.now), db.select({ id: operationalFields.id, key: operationalFields.key, value: operationalFields.value }).from(operationalFields)]);
    if (!site) return err(new CapabilityError('not_found', 'The site record has not been created yet. Run the seed.'));
    const rooms = new Map(VENUE_SPACES.map((s) => [s.ref, s.name]));
    const facts = buildSiteDetails({
      site: { weddingDate: site.weddingDate, venueName: site.venueName, venueAddress: site.venueAddress, venueUrl: site.venueUrl },
      rsvp: { mode: rsvp.mode, deadlineAt: rsvp.deadlineAt ? rsvp.deadlineAt.toISOString() : null, note: rsvp.note },
      events: events.map((e) => ({ id: e.id, name: e.name, dateIso: e.dateIso, startsAt: e.startsAt ? e.startsAt.toISOString() : null, endsAt: e.endsAt ? e.endsAt.toISOString() : null, room: e.venueSpaceRef ? (rooms.get(e.venueSpaceRef) ?? e.venueSpaceRef) : null, dressCode: e.dressCode })),
      block: hotel.block ? { rateText: hotel.block.rateText ?? null, checkIn: hotel.block.checkIn ?? null, checkOut: hotel.block.checkOut ?? null, cutoff: hotel.block.cutoff ?? null, code: hotel.block.code ?? null, placeholder: !!hotel.block.placeholder } : null,
      fields: Object.fromEntries(EDITED_HERE.map((key) => [key, fieldRows.find((r) => r.key === key)])),
      code: { weddingDate: WEDDING_DATE_ISO, venueName: VENUE.name, venueAddress: VENUE.address, valetEntrance: VENUE.valetEntrance, valetNote: VENUE.valetNote, blockCheckIn: CAA_BLOCK_CHECK_IN, blockCheckOut: CAA_BLOCK_CHECK_OUT, blockCutoff: DEFAULT_VENUE_BLOCK.cutoff ?? null, blockRate: DEFAULT_VENUE_BLOCK.rateText ?? null },
      format: { day: formatLongDate, instant: (iso) => formatDeadline(iso, WEDDING_TIMEZONE), window: (s, e) => formatEventWindow(s, e, WEDDING_TIMEZONE) },
    });
    return ok({
      data: {
        groups: DETAIL_GROUPS.map((g) => ({ id: g.id, label: g.label, facts: facts.filter((f) => f.group === g.id) })).filter((g) => g.facts.length > 0),
        counts: { total: facts.length, todo: facts.filter((f) => f.state === 'todo').length, differs: facts.filter((f) => f.state === 'differs').length },
      },
      sources: [],
    });
  },
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-07-17.').refine((v) => {
  // Date.parse rolls 31 February over to March instead of failing; a real day survives the round trip.
  const t = Date.parse(`${v}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}, 'That is not a real date.');
const updateInput = z
  .object({
    weddingDate: day.optional(),
    venueName: z.string().trim().min(2).max(120).optional(),
    venueAddress: z.string().trim().min(5).max(200).optional(),
    venueUrl: z.string().trim().url().startsWith('https://', 'Use an https address.').max(300).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');
const updateOutput = z.object({ weddingDate: z.string(), venueName: z.string(), venueAddress: z.string(), venueUrl: z.string().nullable(), changed: z.array(z.string()) });

/**
 * Changes the site's own record of the day and the place. Every page that prints the date, the
 * venue's name, its address or its website reads this row (the page frame, Our Story, Our
 * Adventures, the dashboard, the RSVP page, the concierge's facts), so one save moves them all.
 * What it does not move is named on the Details screen: each event's own day, and the copies the
 * trip planner keeps in code.
 */
export const adminUpdateSiteDetails = defineCapability<z.infer<typeof updateInput>, z.infer<typeof updateOutput>>({
  name: 'admin_update_site_details',
  title: 'Change the wedding date or venue details',
  description: 'Updates the site’s single record of the wedding date, venue name, venue address and venue website. Pages that show these read the record, so they follow at once. Does not move individual events or the room block. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: updateInput,
  output: updateOutput,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const site = await getSiteSettings(db);
    if (!site) return err(new CapabilityError('not_found', 'The site record has not been created yet. Run the seed.'));
    const patch = {
      ...(i.weddingDate !== undefined && i.weddingDate !== site.weddingDate ? { weddingDate: i.weddingDate } : {}),
      ...(i.venueName !== undefined && i.venueName !== site.venueName ? { venueName: i.venueName } : {}),
      ...(i.venueAddress !== undefined && i.venueAddress !== site.venueAddress ? { venueAddress: i.venueAddress } : {}),
      ...(i.venueUrl !== undefined && i.venueUrl !== site.venueUrl ? { venueUrl: i.venueUrl } : {}),
    };
    const changed = Object.keys(patch);
    const row = changed.length ? (await db.update(siteSettings).set({ ...patch, updatedAt: ctx.now }).where(eq(siteSettings.id, site.id)).returning())[0]! : site;
    if (changed.length) {
      // Which fields, never their values: the audit trail records that the date moved, the row records to what.
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'site_settings', id: site.id }, outcome: 'success', requestId: ctx.requestId, metadata: { fields: changed.join(',') } });
    }
    return ok({ data: { weddingDate: row.weddingDate, venueName: row.venueName, venueAddress: row.venueAddress, venueUrl: row.venueUrl, changed }, sources: [] });
  },
});
