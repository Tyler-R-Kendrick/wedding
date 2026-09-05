import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { actorOf, authOf, callAuth, requireCookieTransport } from './identity/shared';

const input = z.discriminatedUnion('step', [
  z.object({ step: z.literal('options'), authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(), name: z.string().max(80).optional() }),
  z.object({ step: z.literal('verify'), response: z.record(z.string(), z.unknown()), name: z.string().max(80).optional() }),
  z.object({ step: z.literal('list') }),
  z.object({ step: z.literal('remove'), id: z.string().min(1).max(64) }),
]);

const passkeySummary = z.object({ id: z.string(), name: z.string().nullable(), createdAt: z.string().nullable(), deviceType: z.string(), backedUp: z.boolean() });

const output = z.discriminatedUnion('status', [
  z.object({ status: z.literal('options'), options: z.record(z.string(), z.unknown()) }),
  z.object({ status: z.literal('registered'), passkey: passkeySummary }),
  z.object({ status: z.literal('list'), passkeys: z.array(passkeySummary) }),
  z.object({ status: z.literal('removed'), id: z.string() }),
]);

export type RegisterPasskeyResult = z.infer<typeof output>;

const summarize = (p: { id: string; name?: string | null; createdAt?: Date | string | null; deviceType: string; backedUp: boolean }) => ({
  id: p.id,
  name: p.name ?? null,
  createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
});

/**
 * Optional passkey enrollment after a claim (ADR-0001 rule 3), plus list/remove for a lost
 * device. WebAuthn ceremonies run in the browser; the server issues options, verifies the
 * attestation, and audits. Fresh session required (adds a credential).
 */
export const registerPasskey = defineCapability<z.infer<typeof input>, RegisterPasskeyResult>({
  name: 'register_passkey',
  title: 'Set up a passkey',
  description: 'Lets the signed-in person add a passkey (Face ID / Touch ID / security key) for faster sign-in, see their passkeys, or remove one. Always optional; a code works too.',
  kind: 'action',
  auth: 'guest',
  requires: [],
  stepUp: true,
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const p = ctx.principal;
    if (p.kind !== 'guest' && p.kind !== 'admin') return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
    const transport = requireCookieTransport(ctx);
    if (!transport.ok) return err(transport.error);
    const { auth } = await authOf(ctx);
    const { headers, sink } = transport.value;

    if (i.step === 'list') {
      const r = await callAuth(sink, () => auth.api.listPasskeys({ headers }));
      if (!r.ok) return err(new CapabilityError('provider_unavailable', 'Passkeys are not available right now.'));
      return ok({ data: { status: 'list', passkeys: r.value.map(summarize) }, sources: [] });
    }
    if (i.step === 'options') {
      const r = await callAuth(sink, () => auth.api.generatePasskeyRegistrationOptions({ headers, query: { authenticatorAttachment: i.authenticatorAttachment, name: i.name } }));
      if (!r.ok) return err(new CapabilityError('provider_unavailable', 'Passkeys are not available right now. You can keep using codes.'));
      return ok({ data: { status: 'options', options: r.value as unknown as Record<string, unknown> }, sources: [] });
    }
    if (i.step === 'verify') {
      const r = await callAuth(sink, () => auth.api.verifyPasskeyRegistration({ body: { response: i.response as never, name: i.name }, headers }));
      if (!r.ok) {
        await ctx.audit.record({ actor: actorOf(ctx), action: 'passkey.registered', target: { type: 'auth_identity', id: p.authIdentityId }, outcome: 'failed', requestId: ctx.requestId, metadata: { reason: r.error.code } });
        return err(new CapabilityError('validation', 'We couldn’t save that passkey. You can try again or keep using codes.', { reason: r.error.code }));
      }
      const pk = r.value;
      await ctx.audit.record({ actor: actorOf(ctx), action: 'passkey.registered', target: { type: 'auth_identity', id: p.authIdentityId }, outcome: 'success', requestId: ctx.requestId, metadata: { passkeyId: pk.id, deviceType: pk.deviceType, backedUp: pk.backedUp } });
      return ok({ data: { status: 'registered', passkey: summarize(pk) }, sources: [] });
    }
    const r = await callAuth(sink, () => auth.api.deletePasskey({ body: { id: i.id }, headers }));
    if (!r.ok) return err(new CapabilityError('not_found', 'That passkey was not found.'));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'passkey.removed', target: { type: 'auth_identity', id: p.authIdentityId }, outcome: 'success', requestId: ctx.requestId, metadata: { passkeyId: i.id } });
    return ok({ data: { status: 'removed', id: i.id }, sources: [] });
  },
});
