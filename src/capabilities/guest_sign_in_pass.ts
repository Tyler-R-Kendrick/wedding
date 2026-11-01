import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { guestSignInPasses } from '@/db/schema';
import { getGuest, guestDisplayName } from '@/domain/guests/repo';
import {
  guestPassLifecycle,
  guestPassUrl,
  issueGuestSignInPass,
  listGuestPassesForGuest,
  revokeGuestSignInPass,
} from '@/domain/identity/guest-pass';
import { qrSvg } from '@/domain/identity/qr';
import { normalizeEmail } from '@/domain/identity/mask';
import { siteOrigin } from '@/lib/auth';
import { completeGuestPassSignIn } from './identity/guest-pass-signin';
import type { SignInOutcome } from './identity/signin';
import { actorOf, adminOf, requireCookieTransport } from './identity/shared';

const verifyInput = z.object({
  slug: z.string().min(12).max(24),
  code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.'),
});

const verifyOutput = z.object({
  status: z.literal('signed_in'),
  kind: z.literal('sign_in'),
  guestId: z.string().nullable(),
  householdId: z.string().nullable(),
  candidates: z.array(z.object({ guestId: z.string(), displayName: z.string() })),
  isAdmin: z.boolean(),
  authenticatedAt: z.string(),
  next: z.string().nullable(),
});

export const verifyGuestSignInPass = defineCapability<z.infer<typeof verifyInput>, SignInOutcome>({
  name: 'verify_guest_sign_in_pass',
  title: 'Verify a guest sign-in pass',
  description: 'Checks a temporary pass code from an admin-issued short link and signs the guest in. The session cookie is delivered by the transport.',
  kind: 'action',
  auth: 'anonymous',
  requires: [],
  confirmation: 'none',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: verifyInput,
  output: verifyOutput,
  async handler(ctx, i) {
    const transport = requireCookieTransport(ctx);
    if (!transport.ok) return err(transport.error);
    const result = await completeGuestPassSignIn(ctx, i, transport.value);
    if (!result.ok) return err(result.error);
    return ok({ data: result.value, sources: [] });
  },
});

const adminBase = {
  auth: 'admin' as const,
  requires: ['admin_guest_ops'] as const,
  exposure: { ui: true, ai: false, webmcp: false },
};

const passOut = z.object({
  id: z.string(),
  guestId: z.string(),
  slug: z.string(),
  url: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  lifecycle: z.enum(['active', 'expired', 'revoked']),
  failedAttempts: z.number().int(),
  lastVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
});

function decoratePass(row: Awaited<ReturnType<typeof listGuestPassesForGuest>>[number], now: Date) {
  return {
    id: row.id,
    guestId: row.guestId,
    slug: row.slug,
    url: guestPassUrl(siteOrigin(), row.slug),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lifecycle: guestPassLifecycle(row, now),
    failedAttempts: row.failedAttempts,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const adminListGuestSignInPasses = defineCapability({
  ...adminBase,
  name: 'admin_list_guest_sign_in_passes',
  title: 'Admin: list guest sign-in passes',
  description: 'Lists temporary sign-in links issued for one guest.',
  kind: 'read',
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  input: z.object({ guestId: z.string().min(1).max(64) }),
  output: z.object({ passes: z.array(passOut) }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const rows = await listGuestPassesForGuest(db, i.guestId);
    return ok({ data: { passes: rows.map((r) => decoratePass(r, ctx.now)) }, sources: [] });
  },
});

export const adminIssueGuestSignInPass = defineCapability({
  ...adminBase,
  name: 'admin_issue_guest_sign_in_pass',
  title: 'Admin: issue a guest sign-in pass',
  description: 'Creates a temporary six-digit pass and short link for one guest. The code is shown once; only the link belongs in email.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  input: z.object({
    guestId: z.string().min(1).max(64),
    ttlDays: z.number().int().min(1).max(365).optional(),
    expiresAt: z.string().datetime().optional(),
  }),
  output: z.object({
    pass: passOut,
    /** Shown once in the console — never emailed. */
    code: z.string(),
    url: z.string(),
    qrSvg: z.string(),
  }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const issued = await issueGuestSignInPass(db, {
      guestId: i.guestId,
      ttlDays: i.ttlDays,
      expiresAt: i.expiresAt ? new Date(i.expiresAt) : undefined,
      issuedBy: actorOf(ctx),
      requestId: ctx.requestId,
      audit: ctx.audit,
      now: ctx.now,
    });
    if (!issued.ok) return err(issued.error);
    const { pass, code, url } = issued.value;
    return ok({
      data: {
        pass: decoratePass(pass, ctx.now),
        code,
        url,
        qrSvg: qrSvg(url, { title: 'Sign-in link' }),
      },
      sources: [],
    });
  },
});

export const adminRevokeGuestSignInPass = defineCapability({
  ...adminBase,
  name: 'admin_revoke_guest_sign_in_pass',
  title: 'Admin: revoke a guest sign-in pass',
  description: 'Revokes a temporary sign-in link so it cannot be used again.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  input: z.object({ passId: z.string().min(1).max(64) }),
  output: z.object({ pass: passOut }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db } = appServices(ctx);
    const revoked = await revokeGuestSignInPass(db, { passId: i.passId, revokedBy: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!revoked.ok) return err(revoked.error);
    return ok({ data: { pass: decoratePass(revoked.value, ctx.now) }, sources: [] });
  },
});

export const adminEmailGuestSignInPass = defineCapability({
  ...adminBase,
  name: 'admin_email_guest_sign_in_pass',
  title: 'Admin: email a guest sign-in link',
  description: 'Sends the short sign-in link to the guest email on file. The message contains only the link, never the code.',
  kind: 'action',
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  input: z.object({ passId: z.string().min(1).max(64) }),
  output: z.object({ sent: z.boolean(), deliveredTo: z.string() }),
  async handler(ctx, i) {
    const guard = adminOf(ctx);
    if (!guard.ok) return err(guard.error);
    const { db, providers } = appServices(ctx);
    const rows = await db.select().from(guestSignInPasses).where(eq(guestSignInPasses.id, i.passId)).limit(1);
    const pass = rows[0];
    if (!pass) return err(new CapabilityError('not_found', 'That sign-in link could not be found.'));
    const guest = await getGuest(db, pass.guestId);
    if (!guest?.email) return err(new CapabilityError('validation', 'This guest has no email on file. Add one before sending a link.'));
    const email = normalizeEmail(guest.email);
    const url = guestPassUrl(siteOrigin(), pass.slug);
    const mailer = providers('auth-email');
    const sent = await mailer.sendMessage({
      to: email,
      subject: 'Your link to sign in to our wedding site',
      text: `Hello ${guestDisplayName(guest)},\n\nUse this link to sign in:\n${url}\n\nIf you did not expect this, you can ignore it.\n\n— Sara & Tyler`,
    });
    if (!sent.ok) return err(new CapabilityError('provider_unavailable', 'The email could not be sent right now.', { reason: sent.error.class }));
    await ctx.audit.record({
      actor: actorOf(ctx),
      action: 'identity.pass_emailed',
      target: { type: 'guest', id: guest.id },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { passId: pass.id },
    });
    return ok({ data: { sent: true, deliveredTo: email.replace(/(.{1}).*(@.*)/, '$1•••$2') }, sources: [] });
  },
});

export const guestSignInPassCapabilities = [
  verifyGuestSignInPass,
  adminListGuestSignInPasses,
  adminIssueGuestSignInPass,
  adminRevokeGuestSignInPass,
  adminEmailGuestSignInPass,
];
