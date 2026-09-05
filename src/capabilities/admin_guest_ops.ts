import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ADMIN_ROLES } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { adminRoles, GUEST_KINDS, guestAccessBindings, guests, households, INVITATION_STATUSES, invitations, type GuestRow } from '@/db/schema';
import { GUEST_CSV_COLUMNS, GUEST_CSV_OPTIONAL_COLUMNS, parseGuestCsv, toCsv } from '@/domain/guests/csv';
import { deleteGuest, getGuest, guestDisplayName, listGuests, mergeGuests, upsertGuest } from '@/domain/guests/repo';
import { deleteHousehold, findHouseholdByName, getHousehold, listHouseholds, upsertHousehold } from '@/domain/households/repo';
import { activeBindingsForGuests, getAuthUser, rebindIdentity, resetIdentity } from '@/domain/identity/bindings';
import { qrSvg } from '@/domain/identity/qr';
import { invitationLifecycle, invitationUrl } from '@/domain/identity/tokens';
import { currentInvitationsForHouseholds, getInvitation, issueInvitation, listInvitations, revokeInvitation, rotateInvitation } from '@/domain/invitations/repo';
import { normalizeEmail } from '@/domain/identity/mask';
import { siteOrigin } from '@/lib/auth';
import { actorOf, adminOf } from './identity/shared';

/**
 * Admin guest operations (entitlement `admin_guest_ops`). UI-only; never offered to the AI or
 * WebMCP. Emails are visible to the couple here; postal addresses and notes are returned only
 * on detail reads and exported only with an explicit flag. Needs text (dietary, accessibility)
 * lives in Swarm E's tables and is never part of these exports.
 */
const adminBase = {
  auth: 'admin' as const,
  requires: ['admin_guest_ops'] as const,
  exposure: { ui: true, ai: false, webmcp: false },
};
const readAnn = { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false };
const writeAnn = { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true };

const address = z.object({ line1: z.string().max(200).optional(), line2: z.string().max(200).optional(), city: z.string().max(100).optional(), region: z.string().max(100).optional(), postalCode: z.string().max(20).optional(), country: z.string().max(100).optional() });

const guestOut = z.object({
  id: z.string(),
  householdId: z.string(),
  householdName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  kind: z.enum(GUEST_KINDS),
  isMinor: z.boolean(),
  isNamed: z.boolean(),
  plusOneOfGuestId: z.string().nullable(),
  managedByGuestId: z.string().nullable(),
  mergedIntoGuestId: z.string().nullable(),
  notes: z.string().nullable(),
  claimed: z.boolean(),
  claimedAt: z.string().nullable(),
  claimMethod: z.string().nullable(),
  updatedAt: z.string(),
});

async function decorate(db: Parameters<typeof listGuests>[0], rows: GuestRow[]) {
  const hh = await db.select({ id: households.id, name: households.name }).from(households).where(rows.length ? inArray(households.id, [...new Set(rows.map((r) => r.householdId))]) : eq(households.id, ''));
  const names = new Map(hh.map((h) => [h.id, h.name]));
  const bindings = await activeBindingsForGuests(db, rows.map((r) => r.id));
  return rows.map((g) => {
    const b = bindings.get(g.id);
    return {
      id: g.id,
      householdId: g.householdId,
      householdName: names.get(g.householdId) ?? '',
      firstName: g.firstName,
      lastName: g.lastName,
      displayName: guestDisplayName(g),
      email: g.email,
      kind: g.kind,
      isMinor: g.isMinor,
      isNamed: g.isNamed,
      plusOneOfGuestId: g.plusOneOfGuestId,
      managedByGuestId: g.managedByGuestId,
      mergedIntoGuestId: g.mergedIntoGuestId,
      notes: g.notes,
      claimed: !!b,
      claimedAt: b?.claimedAt.toISOString() ?? null,
      claimMethod: b?.claimMethod ?? null,
      updatedAt: g.updatedAt.toISOString(),
    };
  });
}

export const adminListGuests = defineCapability({
  ...adminBase,
  name: 'admin_list_guests',
  title: 'Admin: list guests',
  description: 'Lists guests with household, kind, claim status and email. Admin only.',
  kind: 'read',
  annotations: readAnn,
  input: z.object({ q: z.string().max(100).optional(), householdId: z.string().max(64).optional(), includeMerged: z.boolean().optional(), limit: z.number().int().min(1).max(2000).optional(), offset: z.number().int().min(0).optional() }).optional(),
  output: z.object({ guests: z.array(guestOut) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const rows = await listGuests(db, i ?? {});
    return ok({ data: { guests: await decorate(db, rows) }, sources: [] });
  },
});

export const adminUpsertGuest = defineCapability({
  ...adminBase,
  name: 'admin_upsert_guest',
  title: 'Admin: create or update a guest',
  description: 'Creates or edits a guest row (name, email, kind, manager, notes). Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({
    id: z.string().max(64).optional(),
    householdId: z.string().min(1).max(64),
    firstName: z.string().min(1).max(100),
    lastName: z.string().max(100).optional(),
    email: z.string().max(254).nullable().optional(),
    kind: z.enum(GUEST_KINDS).optional(),
    isMinor: z.boolean().optional(),
    isNamed: z.boolean().optional(),
    plusOneOfGuestId: z.string().max(64).nullable().optional(),
    managedByGuestId: z.string().max(64).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
  output: z.object({ guest: guestOut }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await upsertGuest(db, i);
    if (!r.ok) return err(r.error);
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'guest', id: r.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { created: !i.id } });
    return ok({ data: { guest: (await decorate(db, [r.value]))[0]! }, sources: [] });
  },
});

export const adminDeleteGuest = defineCapability({
  ...adminBase,
  name: 'admin_delete_guest',
  title: 'Admin: delete a guest',
  description: 'Deletes a guest who has no active access binding. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ guestId: z.string().min(1).max(64) }),
  output: z.object({ deleted: z.boolean() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await deleteGuest(db, i.guestId);
    if (!r.ok) return err(r.error);
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'guest', id: i.guestId }, outcome: 'success', requestId: ctx.requestId, metadata: { deleted: true } });
    return ok({ data: { deleted: true }, sources: [] });
  },
});

export const adminMergeGuests = defineCapability({
  ...adminBase,
  name: 'admin_merge_guests',
  title: 'Admin: merge duplicate guests',
  description: 'Merges a duplicate guest into the one to keep, moving or revoking its access binding. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ keepId: z.string().min(1).max(64), mergeId: z.string().min(1).max(64) }),
  output: z.object({ guest: guestOut }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await mergeGuests(db, { ...i, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit });
    if (!r.ok) return err(r.error);
    return ok({ data: { guest: (await decorate(db, [r.value]))[0]! }, sources: [] });
  },
});

const householdOut = z.object({
  id: z.string(),
  name: z.string(),
  managerGuestId: z.string().nullable(),
  memberCount: z.number().int(),
  invitation: z.object({ id: z.string(), status: z.enum(['active', 'claimed', 'expired', 'revoked']), tokenPrefix: z.string(), expiresAt: z.string() }).nullable(),
  updatedAt: z.string(),
});

export const adminListHouseholds = defineCapability({
  ...adminBase,
  name: 'admin_list_households',
  title: 'Admin: list households',
  description: 'Lists households with member counts and current invitation status. Admin only.',
  kind: 'read',
  annotations: readAnn,
  input: z.object({ q: z.string().max(100).optional(), limit: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(0).optional() }).optional(),
  output: z.object({ households: z.array(householdOut) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const rows = await listHouseholds(db, i ?? {});
    const current = await currentInvitationsForHouseholds(db, rows.map((h) => h.id));
    return ok({
      data: {
        households: rows.map((h) => {
          const inv = current.get(h.id);
          return { id: h.id, name: h.name, managerGuestId: h.managerGuestId, memberCount: h.memberCount, invitation: inv ? { id: inv.id, status: invitationLifecycle(inv, ctx.now), tokenPrefix: inv.tokenPrefix, expiresAt: inv.expiresAt.toISOString() } : null, updatedAt: h.updatedAt.toISOString() };
        }),
      },
      sources: [],
    });
  },
});

export const adminGetHousehold = defineCapability({
  ...adminBase,
  name: 'admin_get_household',
  title: 'Admin: household detail',
  description: 'One household with members, manager, mailing address, notes and invitations. Admin only.',
  kind: 'read',
  annotations: readAnn,
  input: z.object({ householdId: z.string().min(1).max(64) }),
  output: z.object({
    household: householdOut.extend({ mailingAddress: address.nullable(), notes: z.string().nullable() }),
    members: z.array(guestOut),
    invitations: z.array(z.object({ id: z.string(), status: z.enum(['active', 'claimed', 'expired', 'revoked']), tokenPrefix: z.string(), issuedAt: z.string(), expiresAt: z.string(), claimedAt: z.string().nullable(), revokedReason: z.string().nullable(), eventKeys: z.array(z.string()), plusOneAllowance: z.number().int(), childrenAllowance: z.number().int() })),
  }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const h = await getHousehold(db, i.householdId);
    if (!h) return err(new CapabilityError('not_found', 'That household does not exist.'));
    const members = await listGuests(db, { householdId: h.id, includeMerged: true });
    const invs = await listInvitations(db, { householdId: h.id });
    const current = invs.find((x) => x.status !== 'revoked') ?? null;
    return ok({
      data: {
        household: {
          id: h.id, name: h.name, managerGuestId: h.managerGuestId, memberCount: members.filter((m) => !m.mergedIntoGuestId).length,
          invitation: current ? { id: current.id, status: invitationLifecycle(current, ctx.now), tokenPrefix: current.tokenPrefix, expiresAt: current.expiresAt.toISOString() } : null,
          updatedAt: h.updatedAt.toISOString(), mailingAddress: h.mailingAddress ?? null, notes: h.notes,
        },
        members: await decorate(db, members),
        invitations: invs.map((x) => ({ id: x.id, status: invitationLifecycle(x, ctx.now), tokenPrefix: x.tokenPrefix, issuedAt: x.issuedAt.toISOString(), expiresAt: x.expiresAt.toISOString(), claimedAt: x.claimedAt?.toISOString() ?? null, revokedReason: x.revokedReason, eventKeys: x.eventKeys, plusOneAllowance: x.plusOneAllowance, childrenAllowance: x.childrenAllowance })),
      },
      sources: [],
    });
  },
});

export const adminUpsertHousehold = defineCapability({
  ...adminBase,
  name: 'admin_upsert_household',
  title: 'Admin: create or update a household',
  description: 'Creates or edits a household (name, manager, mailing address, notes). Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ id: z.string().max(64).optional(), name: z.string().min(1).max(200), managerGuestId: z.string().max(64).nullable().optional(), mailingAddress: address.nullable().optional(), notes: z.string().max(2000).nullable().optional() }),
  output: z.object({ household: householdOut }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await upsertHousehold(db, i);
    if (!r.ok) return err(r.error);
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: r.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { created: !i.id } });
    const inv = (await currentInvitationsForHouseholds(db, [r.value.id])).get(r.value.id);
    const memberCount = (await listGuests(db, { householdId: r.value.id })).length;
    return ok({ data: { household: { id: r.value.id, name: r.value.name, managerGuestId: r.value.managerGuestId, memberCount, invitation: inv ? { id: inv.id, status: invitationLifecycle(inv, ctx.now), tokenPrefix: inv.tokenPrefix, expiresAt: inv.expiresAt.toISOString() } : null, updatedAt: r.value.updatedAt.toISOString() } }, sources: [] });
  },
});

export const adminDeleteHousehold = defineCapability({
  ...adminBase,
  name: 'admin_delete_household',
  title: 'Admin: delete a household',
  description: 'Deletes an empty household. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ householdId: z.string().min(1).max(64) }),
  output: z.object({ deleted: z.boolean() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await deleteHousehold(db, i.householdId);
    if (!r.ok) return err(r.error);
    await ctx.audit.record({ actor: actorOf(ctx), action: 'content.updated', target: { type: 'household', id: i.householdId }, outcome: 'success', requestId: ctx.requestId, metadata: { deleted: true } });
    return ok({ data: { deleted: true }, sources: [] });
  },
});

const issuedOut = z.object({
  invitation: z.object({ id: z.string(), householdId: z.string(), tokenPrefix: z.string(), status: z.enum(INVITATION_STATUSES), expiresAt: z.string() }),
  /** Shown once. Not stored anywhere. */
  token: z.string(),
  url: z.string(),
  qrSvg: z.string(),
});

export const adminListInvitations = defineCapability({
  ...adminBase,
  name: 'admin_list_invitations',
  title: 'Admin: list invitations',
  description: 'Lists invitation links (status, prefix, expiry) — never the tokens themselves. Admin only.',
  kind: 'read',
  annotations: readAnn,
  input: z.object({ householdId: z.string().max(64).optional(), status: z.enum(INVITATION_STATUSES).optional(), limit: z.number().int().min(1).max(2000).optional(), offset: z.number().int().min(0).optional() }).optional(),
  output: z.object({ invitations: z.array(z.object({ id: z.string(), householdId: z.string(), householdName: z.string(), tokenPrefix: z.string(), status: z.enum(INVITATION_STATUSES), lifecycle: z.enum(['active', 'claimed', 'expired', 'revoked']), issuedAt: z.string(), expiresAt: z.string(), claimedAt: z.string().nullable(), revokedAt: z.string().nullable(), revokedReason: z.string().nullable(), eventKeys: z.array(z.string()), plusOneAllowance: z.number().int(), childrenAllowance: z.number().int(), rotatedFromId: z.string().nullable() })) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const rows = await listInvitations(db, i ?? {});
    const hh = await db.select({ id: households.id, name: households.name }).from(households).where(rows.length ? inArray(households.id, [...new Set(rows.map((r) => r.householdId))]) : eq(households.id, ''));
    const names = new Map(hh.map((h) => [h.id, h.name]));
    return ok({
      data: {
        invitations: rows.map((x) => ({ id: x.id, householdId: x.householdId, householdName: names.get(x.householdId) ?? '', tokenPrefix: x.tokenPrefix, status: x.status, lifecycle: invitationLifecycle(x, ctx.now), issuedAt: x.issuedAt.toISOString(), expiresAt: x.expiresAt.toISOString(), claimedAt: x.claimedAt?.toISOString() ?? null, revokedAt: x.revokedAt?.toISOString() ?? null, revokedReason: x.revokedReason, eventKeys: x.eventKeys, plusOneAllowance: x.plusOneAllowance, childrenAllowance: x.childrenAllowance, rotatedFromId: x.rotatedFromId })),
      },
      sources: [],
    });
  },
});

const issued = (inv: { id: string; householdId: string; tokenPrefix: string; status: 'issued' | 'claimed' | 'revoked'; expiresAt: Date }, token: string) => {
  const url = invitationUrl(siteOrigin(), token);
  return { invitation: { id: inv.id, householdId: inv.householdId, tokenPrefix: inv.tokenPrefix, status: inv.status, expiresAt: inv.expiresAt.toISOString() }, token, url, qrSvg: qrSvg(url, { title: 'Invitation link' }) };
};

export const adminIssueInvitation = defineCapability({
  ...adminBase,
  name: 'admin_issue_invitation',
  title: 'Admin: issue an invitation link',
  description: 'Creates a new invitation link (URL + QR) for a household. The token is shown once. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ householdId: z.string().min(1).max(64), eventKeys: z.array(z.string().min(1).max(64)).max(20).optional(), plusOneAllowance: z.number().int().min(0).max(10).optional(), childrenAllowance: z.number().int().min(0).max(20).optional(), expiresAt: z.string().datetime().optional() }),
  output: issuedOut,
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await issueInvitation(db, { ...i, expiresAt: i.expiresAt ? new Date(i.expiresAt) : undefined, issuedBy: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!r.ok) return err(r.error);
    return ok({ data: issued(r.value.invitation, r.value.token), sources: [] });
  },
});

export const adminRotateInvitation = defineCapability({
  ...adminBase,
  name: 'admin_rotate_invitation',
  title: 'Admin: rotate an invitation link',
  description: 'Revokes the current link and issues a fresh one with the same scope. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ invitationId: z.string().min(1).max(64), expiresAt: z.string().datetime().optional() }),
  output: issuedOut,
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await rotateInvitation(db, { invitationId: i.invitationId, expiresAt: i.expiresAt ? new Date(i.expiresAt) : undefined, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!r.ok) return err(r.error);
    return ok({ data: issued(r.value.invitation, r.value.token), sources: [] });
  },
});

export const adminRevokeInvitation = defineCapability({
  ...adminBase,
  name: 'admin_revoke_invitation',
  title: 'Admin: revoke an invitation link',
  description: 'Deactivates an invitation link; the household keeps its access. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ invitationId: z.string().min(1).max(64), reason: z.string().min(1).max(200) }),
  output: z.object({ invitationId: z.string(), status: z.literal('revoked') }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const existing = await getInvitation(db, i.invitationId);
    if (existing?.status === 'revoked') return ok({ data: { invitationId: i.invitationId, status: 'revoked' }, sources: [] });
    const r = await revokeInvitation(db, { invitationId: i.invitationId, reason: i.reason, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!r.ok) return err(r.error);
    return ok({ data: { invitationId: r.value.id, status: 'revoked' }, sources: [] });
  },
});

export const adminResetIdentity = defineCapability({
  ...adminBase,
  name: 'admin_reset_identity',
  title: 'Admin: reset a guest’s access',
  description: 'Revokes a guest’s access binding and ends their sessions so they can claim again. Audited. Admin only; fresh admin session required.',
  kind: 'action',
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ guestId: z.string().min(1).max(64), reason: z.string().min(1).max(200) }),
  output: z.object({ revoked: z.number().int(), sessionsEnded: z.number().int() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    if (!(await getGuest(db, i.guestId))) return err(new CapabilityError('not_found', 'That guest does not exist.'));
    const r = await resetIdentity(db, { ...i, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!r.ok) return err(r.error);
    return ok({ data: r.value, sources: [] });
  },
});

export const adminRebindIdentity = defineCapability({
  ...adminBase,
  name: 'admin_rebind_identity',
  title: 'Admin: rebind a guest to an email',
  description: 'Moves a guest’s access to a different email (e.g. a lost inbox). The previous binding is revoked and both steps are audited. Admin only; fresh admin session required.',
  kind: 'action',
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ guestId: z.string().min(1).max(64), email: z.string().min(3).max(254), reason: z.string().min(1).max(200) }),
  output: z.object({ bindingId: z.string(), guestId: z.string(), email: z.string() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const r = await rebindIdentity(db, { ...i, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!r.ok) return err(r.error);
    const user = await getAuthUser(db, r.value.authIdentityId);
    return ok({ data: { bindingId: r.value.id, guestId: r.value.guestId, email: user?.email ?? normalizeEmail(i.email) }, sources: [] });
  },
});

export const adminImportGuestsCsv = defineCapability({
  ...adminBase,
  name: 'admin_import_guests_csv',
  title: 'Admin: import guests from CSV',
  description: 'Imports households and guests from a CSV (columns: household, first_name, last_name, email, kind, is_minor, manager, plus_one_of, event_keys, notes, address_*). Existing rows match by household + name. Admin only.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
  input: z.object({ csv: z.string().min(1).max(1_000_000), dryRun: z.boolean().optional() }),
  output: z.object({ dryRun: z.boolean(), householdsCreated: z.number().int(), guestsCreated: z.number().int(), guestsUpdated: z.number().int(), skipped: z.number().int(), issues: z.array(z.object({ line: z.number().int(), message: z.string() })) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const { records, issues } = parseGuestCsv(i.csv);
    const summary = { dryRun: !!i.dryRun, householdsCreated: 0, guestsCreated: 0, guestsUpdated: 0, skipped: issues.length, issues: [...issues] };
    if (i.dryRun) {
      const seen = new Set<string>();
      for (const r of records) {
        if (!seen.has(r.household) && !(await findHouseholdByName(db, r.household))) summary.householdsCreated++;
        seen.add(r.household);
      }
      summary.guestsCreated = records.length;
      return ok({ data: summary, sources: [] });
    }
    const householdIds = new Map<string, string>();
    const managers = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const r of records) {
      let hid = householdIds.get(r.household);
      if (!hid) {
        const existing = await findHouseholdByName(db, r.household);
        if (existing) hid = existing.id;
        else {
          const created = await upsertHousehold(db, { name: r.household, mailingAddress: r.address ?? undefined });
          if (!created.ok) { summary.issues.push({ line: r.line, message: created.error.message }); summary.skipped++; continue; }
          hid = created.value.id;
          summary.householdsCreated++;
        }
        householdIds.set(r.household, hid);
      }
      const existingRows = await db.select().from(guests).where(and(eq(guests.householdId, hid), eq(guests.firstName, r.firstName), eq(guests.lastName, r.lastName), isNull(guests.mergedIntoGuestId))).limit(1);
      const existing = existingRows[0];
      const up = await upsertGuest(db, { id: existing?.id, householdId: hid, firstName: r.firstName, lastName: r.lastName, email: r.email ?? existing?.email ?? null, kind: r.kind, isMinor: r.isMinor, notes: r.notes ?? existing?.notes ?? null, managedByGuestId: existing?.managedByGuestId ?? null, plusOneOfGuestId: existing?.plusOneOfGuestId ?? null });
      if (!up.ok) { summary.issues.push({ line: r.line, message: up.error.message }); summary.skipped++; continue; }
      if (existing) summary.guestsUpdated++;
      else summary.guestsCreated++;
      byName.set(`${hid}:${[r.firstName, r.lastName].filter(Boolean).join(' ').toLowerCase()}`, up.value.id);
      if (r.manager) managers.set(hid, up.value.id);
      if (r.plusOneOf) {
        const host = byName.get(`${hid}:${r.plusOneOf.toLowerCase()}`);
        if (host) await db.update(guests).set({ plusOneOfGuestId: host, kind: 'plus_one', updatedAt: ctx.now }).where(eq(guests.id, up.value.id));
      }
    }
    for (const [hid, managerId] of managers) await db.update(households).set({ managerGuestId: managerId, updatedAt: ctx.now }).where(eq(households.id, hid));
    // Households without an explicit manager default to their first adult with an email.
    for (const hid of householdIds.values()) {
      if (managers.has(hid)) continue;
      const h = await getHousehold(db, hid);
      if (h?.managerGuestId) continue;
      const adult = (await listGuests(db, { householdId: hid })).find((g) => g.kind !== 'child' && !g.isMinor && g.email);
      if (adult) await db.update(households).set({ managerGuestId: adult.id, updatedAt: ctx.now }).where(eq(households.id, hid));
    }
    await ctx.audit.record({ actor: actorOf(ctx), action: 'guest.imported', target: { type: 'guest_import', id: ctx.requestId }, outcome: 'success', requestId: ctx.requestId, metadata: { householdsCreated: summary.householdsCreated, guestsCreated: summary.guestsCreated, guestsUpdated: summary.guestsUpdated, skipped: summary.skipped } });
    return ok({ data: summary, sources: [] });
  },
});

export const adminExportGuestsCsv = defineCapability({
  ...adminBase,
  name: 'admin_export_guests_csv',
  title: 'Admin: export guests as CSV',
  description: 'Exports households and guests as CSV. Admin notes and mailing addresses are excluded unless explicitly included; dietary/accessibility needs are never part of this export. Admin only.',
  kind: 'read',
  annotations: readAnn,
  input: z.object({ includeNotes: z.boolean().optional(), includeAddress: z.boolean().optional() }).optional(),
  output: z.object({ csv: z.string(), rows: z.number().int(), columns: z.array(z.string()) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const includeNotes = !!i?.includeNotes;
    const includeAddress = !!i?.includeAddress;
    const rows = await listGuests(db, { limit: 2000 });
    const hh = await db.select().from(households);
    const byId = new Map(hh.map((h) => [h.id, h]));
    const invs = await currentInvitationsForHouseholds(db, hh.map((h) => h.id));
    const nameOf = new Map(rows.map((g) => [g.id, [g.firstName, g.lastName].filter(Boolean).join(' ')]));
    const columns: string[] = [...GUEST_CSV_COLUMNS, 'claimed', ...(includeNotes ? ['notes'] : []), ...(includeAddress ? GUEST_CSV_OPTIONAL_COLUMNS.filter((c) => c.startsWith('address_')) : [])];
    const bindings = await activeBindingsForGuests(db, rows.map((g) => g.id));
    const out = rows.map((g) => {
      const h = byId.get(g.householdId);
      const a = h?.mailingAddress ?? {};
      return [
        h?.name ?? '', g.firstName, g.lastName, g.email ?? '', g.kind, g.isMinor ? 'yes' : 'no', h?.managerGuestId === g.id ? 'yes' : '', g.plusOneOfGuestId ? (nameOf.get(g.plusOneOfGuestId) ?? '') : '', (invs.get(g.householdId)?.eventKeys ?? []).join(';'),
        bindings.has(g.id) ? 'yes' : 'no',
        ...(includeNotes ? [g.notes ?? ''] : []),
        ...(includeAddress ? [a.line1 ?? '', a.line2 ?? '', a.city ?? '', a.region ?? '', a.postalCode ?? '', a.country ?? ''] : []),
      ];
    });
    await ctx.audit.record({ actor: actorOf(ctx), action: 'guest.exported', target: { type: 'guest_export', id: ctx.requestId }, outcome: 'success', requestId: ctx.requestId, metadata: { rows: out.length, includeNotes, includeAddress, includeNeeds: false } });
    return ok({ data: { csv: toCsv([columns, ...out]), rows: out.length, columns }, sources: [] });
  },
});

export const adminSetAdminRole = defineCapability({
  ...adminBase,
  name: 'admin_set_admin_role',
  title: 'Admin: grant or remove an admin role',
  description: 'Owners grant planner/moderator/owner roles by email, or remove them. ADMIN_EMAILS owners cannot be removed here. Audited.',
  kind: 'action',
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: writeAnn,
  input: z.object({ email: z.string().min(3).max(254), role: z.enum(ADMIN_ROLES).nullable() }),
  output: z.object({ email: z.string(), role: z.enum(ADMIN_ROLES).nullable() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx, ['owner']);
    if (!guard.ok) return err(guard.error);
    const admin = guard.value;
    const { db } = appServices(ctx);
    const email = normalizeEmail(i.email);
    if (i.role) {
      await db.insert(adminRoles).values({ email, role: i.role, grantedBy: actorOf(ctx), grantedAt: ctx.now }).onConflictDoUpdate({ target: adminRoles.email, set: { role: i.role, grantedBy: actorOf(ctx), grantedAt: ctx.now } });
    } else {
      await db.delete(adminRoles).where(eq(adminRoles.email, email));
    }
    await ctx.audit.record({ actor: actorOf(ctx), action: 'admin.role_changed', target: { type: 'admin_role', id: email }, outcome: 'success', requestId: ctx.requestId, metadata: { role: i.role, by: admin.adminId } });
    return ok({ data: { email, role: i.role }, sources: [] });
  },
});

export const adminGuestOpsCapabilities = [
  adminListGuests, adminUpsertGuest, adminDeleteGuest, adminMergeGuests,
  adminListHouseholds, adminGetHousehold, adminUpsertHousehold, adminDeleteHousehold,
  adminListInvitations, adminIssueInvitation, adminRotateInvitation, adminRevokeInvitation,
  adminResetIdentity, adminRebindIdentity, adminImportGuestsCsv, adminExportGuestsCsv, adminSetAdminRole,
];

export { guestAccessBindings, invitations };
