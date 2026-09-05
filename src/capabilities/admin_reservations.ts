import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { SLUG } from '@/domain/external/schemas';
import { listReservationVenueRows, reservationOptions, upsertReservationVenue } from '@/domain/reservations';
import { appServices } from './context';
import { reservationOptionSchema } from './get_reservation_options';

const VENUE_SLUG = /^[a-z0-9-]{1,80}$/;

const upsertInput = z.object({
  id: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(120),
  placeRef: z.string().trim().max(64).optional(),
  resySlug: z.string().regex(VENUE_SLUG).optional(),
  openTableId: z.string().regex(VENUE_SLUG).optional(),
  url: z.url().optional(),
  note: z.string().trim().max(300).optional(),
  placeholder: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  sourceId: z.string().regex(ID_PATTERN).optional(),
  verifiedAt: z.string().datetime({ offset: true }).optional(),
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
    let url: string | undefined;
    if (i.url) {
      const allowed = assertAllowedRedirect(i.url);
      if (!allowed.ok) return err(new CapabilityError('validation', 'That link is not on our list of trusted partners.', { issues: [{ path: 'url', message: allowed.error.message }] }));
      url = allowed.value.toString();
    }
    const { db } = appServices(ctx);
    const row = await upsertReservationVenue(db, { ...i, url, verifiedAt: i.verifiedAt ? new Date(i.verifiedAt) : undefined, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'reservation_venue', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active, placeholder: row.placeholder, hasResy: !!row.resySlug, hasOpenTable: !!row.openTableId, hasUrl: !!row.url } });
    return ok({ data: toRow(row), sources: [] });
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

export const adminReservationCapabilities = [adminUpsertReservationVenue, adminListReservationVenues];
