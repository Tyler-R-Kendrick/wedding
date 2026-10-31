import { z } from 'zod';
import { appServices } from '@/capabilities/context';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { previewPersonasReady } from '@/domain/identity/preview-personas';
import { mintViewRoleToken, verifyViewRoleToken, VIEW_ROLES, viewRoleLabel, type ViewRoleKey } from '@/domain/identity/view-role';
import { buildViewRolePrincipal } from '@/domain/identity/principal';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { actorOf, adminOf } from './shared';

const roleSchema = z.enum(VIEW_ROLES);

const output = z.object({
  role: roleSchema,
  label: z.string(),
  readOnly: z.literal(true),
  token: z.string(),
  expiresAt: z.string(),
});

/**
 * Starts admin view-role preview for this session. Clears any profile-specific guest-view cookie
 * when minting a role token; the resolver always re-checks that the caller is an administrator.
 */
export const adminSetViewRole = defineCapability<{ role: ViewRoleKey }, z.infer<typeof output>>({
  name: 'admin_set_view_role',
  title: 'Admin: preview the site as a role',
  description:
    'Lets an administrator preview the guest site with a role’s entitlements (invited guest, plus-one, household manager, wedding party) using synthetic preview records — not a real guest’s identity. Read-only; audited. Admin only.',
  kind: 'navigate',
  auth: 'admin',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({ role: roleSchema }),
  output,
  async handler(ctx, { role }) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const admin = guard.value;
    const { db } = appServices(ctx);
    if (!(await previewPersonasReady(db))) return err(new CapabilityError('internal', 'Preview personas are not seeded yet. Run db:seed or wait for the next deploy.'));
    const session = { authIdentityId: admin.authIdentityId, sessionId: admin.sessionId, authenticatedAt: new Date(admin.authenticatedAt), activeGuestId: null, email: '' };
    const view = await buildViewRolePrincipal(db, session, admin, role, ctx.flags, ctx.now);
    if (!view?.viewedBy?.previewRole) return err(new CapabilityError('internal', 'Could not build a preview for that role.'));
    const minted = mintViewRoleToken(role, admin.sessionId, getPreviewSecret(), ctx.now);
    await ctx.audit.record({
      actor: actorOf(ctx),
      action: 'view_role.started',
      target: { type: 'view_role', id: role },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { label: viewRoleLabel(role), expiresAt: minted.expiresAt },
    });
    return ok({
      data: { role, label: viewRoleLabel(role), readOnly: true, token: minted.token, expiresAt: minted.expiresAt },
      sources: [],
    });
  },
});

export const adminClearViewRole = defineCapability<Record<string, never>, { cleared: boolean }>({
  name: 'admin_clear_view_role',
  title: 'Admin: stop previewing as a role',
  description: 'Clears this browser’s view-role preview token. Admin only.',
  kind: 'navigate',
  auth: 'admin',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({}).strict(),
  output: z.object({ cleared: z.boolean() }),
  async handler(ctx) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    await ctx.audit.record({
      actor: actorOf(ctx),
      action: 'view_role.ended',
      target: { type: 'view_role', id: 'none' },
      outcome: 'success',
      requestId: ctx.requestId,
    });
    return ok({ data: { cleared: true }, sources: [] });
  },
});

export const adminListViewRoles = defineCapability<Record<string, never>, { roles: { role: ViewRoleKey; label: string }[] }>({
  name: 'admin_list_view_roles',
  title: 'Admin: roles available for preview',
  description: 'Lists the guest experience roles an administrator can preview. Admin only.',
  kind: 'read',
  auth: 'admin',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({}).strict(),
  output: z.object({ roles: z.array(z.object({ role: roleSchema, label: z.string() })) }),
  async handler(ctx) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    return ok({ data: { roles: VIEW_ROLES.map((role) => ({ role, label: viewRoleLabel(role) })) }, sources: [] });
  },
});

export const adminViewRoleStatus = defineCapability<{ token?: string }, { view: { role: ViewRoleKey; label: string; readOnly: true } | null }>({
  name: 'admin_view_role_status',
  title: 'Admin: which role am I previewing',
  description: 'Given this browser’s view-role token, says which role the administrator is previewing, if any. Admin only.',
  kind: 'read',
  auth: 'admin',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.object({ token: z.string().max(200).optional() }).strict(),
  output: z.object({ view: z.object({ role: roleSchema, label: z.string(), readOnly: z.literal(true) }).nullable() }),
  async handler(ctx, { token }) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const verified = token ? verifyViewRoleToken(token, guard.value.sessionId, getPreviewSecret(), ctx.now) : null;
    if (!verified) return ok({ data: { view: null }, sources: [] });
    return ok({ data: { view: { role: verified.role, label: viewRoleLabel(verified.role), readOnly: true } }, sources: [] });
  },
});
