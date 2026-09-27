import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { SLUG } from '@/domain/external/schemas';
import { deleteReservationVenue, listReservationVenueRows, reservationOptions, upsertReservationVenue } from '@/domain/reservations';
import { appServices } from './context';
import { reservationOptionSchema } from './get_reservation_options';

const VENUE_SLUG = /^[a-z0-9-]{1,80}$/;

/**
 * An optional text an edit can clear. Left out (`undefined`), a save keeps what the row holds; `null`
 * or an empty string clears it. The one-click Hide, Up and Down send the row as the page has it, and
 * the page never sees a place's `sourceId`: left out, it survives.
 */
const clearable = <T extends z.ZodType<string>>(s: T) =>
  z
    .union([s, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

const MAX_CLOCK_SKEW_MS = 60_000;

/** On an existing place, a field left out keeps its saved value; on a new one it takes the default: shown, not a placeholder, first in order. */
const upsertInput = z.object({
  id: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(120),
  placeRef: clearable(z.string().trim().max(64)),
  resySlug: clearable(z.string().regex(VENUE_SLUG)),
  openTableId: clearable(z.string().regex(VENUE_SLUG)),
  url: clearable(z.url()),
  note: clearable(z.string().trim().max(300)),
  placeholder: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  sourceId: z.string().regex(ID_PATTERN).nullable().optional(),
  /** A saved check sent back unchanged (a one-click Hide or Up keeps it); `null` clears it. A new check is `confirmed`. Never in the future. */
  verifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** The admin opened the booking page and confirmed it is this place: stamped with the server's clock, never the browser's. */
  confirmed: z.boolean().optional(),
});

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  placeRef: z.string().nullable(),
  resySlug: z.string().nullable(),
  openTableId: z.string().nullable(),
  url: z.string().nullable(),
  note: z.string().nullable(),
  placeholder: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number(),
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const toRow = (r: Awaited<ReturnType<typeof upsertReservationVenue>>) => ({ ...r, sourceId: undefined, updatedBy: undefined, createdAt: undefined, verifiedAt: r.verifiedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() });

export const adminUpsertReservationVenue = defineCapability<z.infer<typeof upsertInput>, z.infer<typeof rowSchema>>({
  name: 'admin_upsert_reservation_venue',
  title: 'Configure a reservable place',
  description: 'Admin: creates or updates a place guests can reserve at, with its Resy slug, OpenTable id and/or booking page (allowlisted hosts only).',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: upsertInput,
  output: rowSchema,
  async handler(ctx, i) {
    let url = i.url;
    if (i.url) {
      const allowed = assertAllowedRedirect(i.url);
      if (!allowed.ok) return err(new CapabilityError('validation', 'That link is not on our list of trusted partners.', { issues: [{ path: 'url', message: allowed.error.message }] }));
      url = allowed.value.toString();
    }
    // `confirmed` stamps the server's clock. A time sent back is bounded the way `markContentVerified`
    // bounds one: a check cannot be dated after the save that records it.
    let verifiedAt: Date | null | undefined = i.verifiedAt === undefined || i.verifiedAt === null ? i.verifiedAt : new Date(i.verifiedAt);
    if (i.confirmed) verifiedAt = ctx.now;
    else if (verifiedAt && (Number.isNaN(verifiedAt.getTime()) || verifiedAt.getTime() > ctx.now.getTime() + MAX_CLOCK_SKEW_MS)) {
      return err(new CapabilityError('validation', 'The verification time must be a valid time, not in the future.', { issues: [{ path: 'verifiedAt', message: 'invalid or in the future' }] }));
    }
    const { db } = appServices(ctx);
    const { confirmed: _confirmed, ...fields } = i;
    const row = await upsertReservationVenue(db, { ...fields, url, verifiedAt, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'reservation_venue', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active, placeholder: row.placeholder, hasResy: !!row.resySlug, hasOpenTable: !!row.openTableId, hasUrl: !!row.url } });
    return ok({ data: toRow(row), sources: [] });
  },
});

const deleteInput = z.object({ id: z.string().regex(SLUG) });

/** Admin: deletes a saved place. When the last one goes, guests see the built-in placeholders again. */
export const adminDeleteReservationVenue = defineCapability<z.infer<typeof deleteInput>, { id: string; deleted: boolean }>({
  name: 'admin_delete_reservation_venue',
  title: 'Delete a reservable place',
  description: 'Admin: deletes a place guests can reserve at. With no saved places left, guests see the built-in placeholders.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: deleteInput,
  output: z.object({ id: z.string(), deleted: z.boolean() }),
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const deleted = await deleteReservationVenue(db, i.id);
    if (!deleted) return err(new CapabilityError('not_found', 'That place is not saved any more.'));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'reservation_venue', id: i.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete' } });
    return ok({ data: { id: i.id, deleted }, sources: [] });
  },
});

const listOutput = z.object({ rows: z.array(rowSchema), effective: z.array(reservationOptionSchema) });

export const adminListReservationVenues = defineCapability<unknown, z.infer<typeof listOutput>>({
  name: 'admin_list_reservation_venues',
  title: 'Reservable places (admin)',
  description: 'Admin: every configured place (including inactive) and the ladder rung guests currently get for each.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.unknown(),
  output: listOutput,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const [rows, effective] = await Promise.all([listReservationVenueRows(db, { includeInactive: true }), reservationOptions(db, providers('reservations'), {})]);
    return ok({ data: { rows: rows.map(toRow), effective: effective?.options ?? [] }, sources: [] });
  },
});

export const adminReservationCapabilities = [adminUpsertReservationVenue, adminListReservationVenues, adminDeleteReservationVenue];
