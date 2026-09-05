import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { getTransportVault } from '@/domain/external/vault';
import { SLUG } from '@/domain/external/schemas';
import { countManualCodes, DEFAULT_PROGRAM, getEntitlement, listClaims, listEntitlements, setEntitlementStatus, uploadManualCodes, upsertEntitlement } from '@/domain/transport';
import { appServices } from './context';

const GUEST_REF = z.string().trim().min(1).max(64);
const NOTE = z.string().trim().max(300).optional();
const ISO = z.string().datetime({ offset: true }).optional();

const entitlementSummary = z.object({
  id: z.string(),
  guestId: z.string(),
  householdId: z.string(),
  program: z.string(),
  providerProgramRef: z.string().nullable(),
  amountNote: z.string().nullable(),
  validityNote: z.string().nullable(),
  geofenceNote: z.string().nullable(),
  guestIsMinor: z.boolean(),
  status: z.enum(['active', 'revoked']),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const summarize = (e: Awaited<ReturnType<typeof getEntitlement>> & object) => ({
  id: e.id,
  guestId: e.guestId,
  householdId: e.householdId,
  program: e.program,
  providerProgramRef: e.providerProgramRef,
  amountNote: e.amountNote,
  validityNote: e.validityNote,
  geofenceNote: e.geofenceNote,
  guestIsMinor: e.guestIsMinor,
  status: e.status,
  validFrom: e.validFrom?.toISOString() ?? null,
  validUntil: e.validUntil?.toISOString() ?? null,
  verifiedAt: e.verifiedAt?.toISOString() ?? null,
  updatedAt: e.updatedAt.toISOString(),
});

const assignInput = z.object({
  guestId: GUEST_REF,
  householdId: GUEST_REF,
  program: z.string().regex(SLUG).default(DEFAULT_PROGRAM),
  providerProgramRef: z.string().trim().max(120).optional(),
  amountNote: NOTE,
  validityNote: NOTE,
  geofenceNote: NOTE,
  guestIsMinor: z.boolean().default(false),
  validFrom: ISO,
  validUntil: ISO,
  sourceId: z.string().regex(ID_PATTERN).optional(),
  verifiedAt: ISO,
});

export const adminAssignTransportationEntitlement = defineCapability<z.infer<typeof assignInput>, z.infer<typeof entitlementSummary>>({
  name: 'admin_assign_transportation_entitlement',
  title: 'Assign a ride benefit',
  description: 'Admin: assigns (or updates) one guest’s ride benefit with admin-entered amount, validity and area notes. Marks minors ineligible. Never issues a code by itself.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: assignInput,
  output: entitlementSummary,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const row = await upsertEntitlement(
      db,
      {
        guestId: i.guestId,
        householdId: i.householdId,
        program: i.program,
        providerProgramRef: i.providerProgramRef,
        amountNote: i.amountNote,
        validityNote: i.validityNote,
        geofenceNote: i.geofenceNote,
        guestIsMinor: i.guestIsMinor,
        validFrom: i.validFrom ? new Date(i.validFrom) : undefined,
        validUntil: i.validUntil ? new Date(i.validUntil) : undefined,
        sourceId: i.sourceId,
        verifiedAt: i.verifiedAt ? new Date(i.verifiedAt) : undefined,
        assignedBy: toPrincipalRef(ctx.principal),
      },
      ctx.now,
    );
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'transport.entitlement_assigned', target: { type: 'transportation_entitlement', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { guestId: row.guestId, householdId: row.householdId, program: row.program, guestIsMinor: row.guestIsMinor } });
    return ok({ data: summarize(row), sources: [] });
  },
});

const revokeInput = z.object({ entitlementId: z.string().regex(ID_PATTERN), status: z.enum(['active', 'revoked']).default('revoked') });

export const adminRevokeTransportationEntitlement = defineCapability<z.infer<typeof revokeInput>, z.infer<typeof entitlementSummary>>({
  name: 'admin_revoke_transportation_entitlement',
  title: 'Revoke or reactivate a ride benefit',
  description: 'Admin: revokes (or reactivates) a guest’s ride benefit. An already-issued credit is not recalled from the provider; the guest is told to ask the couple.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: revokeInput,
  output: entitlementSummary,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const row = await setEntitlementStatus(db, i.entitlementId, i.status, ctx.now);
    if (!row) return err(new CapabilityError('not_found', 'No such ride benefit.'));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'transport.entitlement_assigned', target: { type: 'transportation_entitlement', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { status: row.status } });
    return ok({ data: summarize(row), sources: [] });
  },
});

const uploadInput = z.object({ program: z.string().regex(SLUG).default(DEFAULT_PROGRAM), codes: z.array(z.string().max(64)).min(1).max(500) });
const uploadOutput = z.object({ program: z.string(), added: z.number(), duplicates: z.number(), rejected: z.number() });

export const adminUploadTransportationCodes = defineCapability<z.infer<typeof uploadInput>, z.infer<typeof uploadOutput>>({
  name: 'admin_upload_transportation_codes',
  title: 'Upload ride codes',
  description: 'Admin: uploads manual ride codes for a programme. Codes are sealed at rest and never echoed back; the result is counts only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_integrations'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: uploadInput,
  output: uploadOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const result = await uploadManualCodes(db, await getTransportVault(), { program: i.program, codes: i.codes, uploadedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'provider.configured', target: { type: 'transportation_manual_codes', id: i.program }, outcome: 'success', requestId: ctx.requestId, metadata: { ...result } });
    return ok({ data: { program: i.program, ...result }, sources: [] });
  },
});

const listInput = z.object({ householdId: GUEST_REF.optional(), limit: z.number().int().min(1).max(1000).optional() }).optional();
const listOutput = z.object({
  entitlements: z.array(entitlementSummary.extend({ claim: z.object({ claimId: z.string(), status: z.enum(['pending', 'issued', 'failed', 'revoked']), provider: z.string(), redemptionKind: z.enum(['link', 'code', 'none']), claimedAt: z.string().nullable() }).nullable() })),
  codePools: z.array(z.object({ program: z.string(), available: z.number(), issued: z.number() })),
  provider: z.object({ name: z.string(), mode: z.string() }),
});

export const adminListTransportationEntitlements = defineCapability<z.infer<typeof listInput>, z.infer<typeof listOutput>>({
  name: 'admin_list_transportation_entitlements',
  title: 'Ride benefits overview',
  description: 'Admin: every assigned ride benefit with its claim status and the manual code pools. Never includes a code or redemption link.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: listInput,
  output: listOutput,
  async handler(ctx, i) {
    const { db, providers } = appServices(ctx);
    const [rows, claims, codePools] = await Promise.all([listEntitlements(db, { householdId: i?.householdId, limit: i?.limit }), listClaims(db, { limit: 1000 }), countManualCodes(db)]);
    const byEntitlement = new Map(claims.map((c) => [c.entitlementId, c]));
    const provider = providers('transport-benefit');
    return ok({
      data: {
        entitlements: rows.map((e) => {
          const c = byEntitlement.get(e.id);
          return { ...summarize(e), claim: c ? { claimId: c.id, status: c.status, provider: c.providerName, redemptionKind: c.redemptionKind, claimedAt: c.claimedAt?.toISOString() ?? null } : null };
        }),
        codePools,
        provider: { name: provider.name, mode: provider.mode },
      },
      sources: [],
    });
  },
});

export const adminTransportCapabilities = [adminAssignTransportationEntitlement, adminRevokeTransportationEntitlement, adminUploadTransportationCodes, adminListTransportationEntitlements];
