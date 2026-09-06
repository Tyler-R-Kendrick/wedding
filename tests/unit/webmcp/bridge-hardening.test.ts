import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import { MemoryIdempotencyStore } from '@/capabilities/services';
import { defineCapability, type AnyCapability, type CapabilityContext } from '@/contracts/capability';
import { readFlags } from '@/contracts/flags';
import type { AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { Entitlement, Principal } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { MemoryAuditSink } from '@/lib/audit';
import { effectiveWebMcpDescriptor, invokeForWebMcp } from '@/webmcp/server/invoke';

/**
 * Hardening from the adversarial review (review-K/findings.md), findings 1 and 2. Both are about
 * what the bridge does that the pipeline cannot do for itself.
 */
const guest = (entitlements: Entitlement[] = []): Principal => ({
  kind: 'guest',
  authIdentityId: 'auth-1' as AuthIdentityId,
  guestId: 'guest-1' as GuestId,
  householdId: 'house-1' as HouseholdId,
  actsFor: ['guest-1' as GuestId],
  entitlements: new Set(entitlements),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'session-1',
});

function context(principal: Principal = { kind: 'anonymous' }): CapabilityContext & { audit: MemoryAuditSink } {
  const audit = new MemoryAuditSink();
  return {
    principal,
    requestId: 'r',
    now: new Date(),
    flags: readFlags({}),
    audit,
    inputTrust: 'UNTRUSTED_USER_CONTENT',
    surface: 'webmcp',
    services: { idempotency: new MemoryIdempotencyStore() },
  };
}

const cap = (over: Partial<AnyCapability> & { name: string }): AnyCapability =>
  defineCapability({
    title: 'T',
    description: 'Does a thing.',
    kind: 'read',
    auth: 'anonymous',
    requires: [],
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    exposure: { ui: true, ai: true, webmcp: true },
    input: z.object({ value: z.string() }).optional(),
    output: z.object({ saved: z.boolean() }),
    handler: async () => ok({ data: { saved: true }, sources: [] }),
    ...over,
  } as AnyCapability);

const mutation = (over: Partial<AnyCapability> & { name: string }) =>
  cap({
    kind: 'action',
    auth: 'guest',
    requires: ['rsvp_self'],
    annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    ...over,
  });

describe('finding 1: confirmation: inline does not evaporate on the agent surface', () => {
  const inline = mutation({ name: 'save_inline', confirmation: 'inline' });
  const optedOut = mutation({ name: 'save_opted_out', confirmation: 'inline', agentConfirmable: true });

  it('invokes an inline mutation as explicit, so the pipeline demands a human on the page', async () => {
    // `inline` is a promise the PAGE keeps. There is no page here.
    expect(effectiveWebMcpDescriptor(inline).confirmation).toBe('explicit');

    const registry = new CapabilityRegistryImpl();
    registry.register(inline);
    const result = await invokeForWebMcp(registry, 'save_inline', context(guest(['rsvp_self'])), { value: 'agent-wrote-this' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('confirmation_required');
      expect(result.error.details?.reason).toBe('requires_ui');
    }
  });

  it('honours an explicit per-descriptor opt-out, and only for inline', async () => {
    expect(effectiveWebMcpDescriptor(optedOut).confirmation).toBe('inline');
    const registry = new CapabilityRegistryImpl();
    registry.register(optedOut);
    const result = await invokeForWebMcp(registry, 'save_opted_out', context(guest(['rsvp_self'])), { value: 'v' });
    expect(result.ok).toBe(true);

    // The opt-out never reaches the modes that are not the page's to promise.
    for (const d of [
      mutation({ name: 'save_explicit', confirmation: 'explicit', agentConfirmable: true }),
      mutation({ name: 'claim_thing', kind: 'transaction', stepUp: true, confirmation: 'inline', agentConfirmable: true }),
      mutation({ name: 'open_thing', kind: 'external', confirmation: 'inline', agentConfirmable: true }),
    ]) {
      expect(effectiveWebMcpDescriptor(d).confirmation, d.name).toBe('explicit');
    }
  });
});

describe('finding 2: the bridge is not an oracle for the registry', () => {
  const registry = new CapabilityRegistryImpl();
  const hidden = cap({ name: 'hidden_thing', exposure: { ui: true, ai: false, webmcp: false } });
  const guestOnly = cap({ name: 'guest_thing', auth: 'guest', requires: ['view_table_assignment'] });
  const entitled = cap({ name: 'entitled_thing', auth: 'guest', requires: ['admin_audit'] });
  const flagged = cap({ name: 'flagged_thing', flag: 'MEDIA_SEMANTIC_SEARCH' });
  registry.registerAll([hidden, guestOnly, entitled, flagged, cap({ name: 'open_read' })]);

  const answer = async (name: string, principal?: Principal, flags = readFlags({})) => {
    const ctx = { ...context(principal), flags };
    // `undefined` satisfies the optional input schema, so the pipeline reaches authorization
    // rather than stopping at validation — the denial under test is the authorization one.
    const result = await invokeForWebMcp(registry, name, ctx, undefined);
    return result.ok ? 'ok' : `${result.error.code}:${result.error.message}`;
  };

  it('answers identically for absent, hidden, needs-sign-in, needs-entitlement and flagged-off', async () => {
    const buckets = {
      absent: await answer('no_such_capability'),
      hiddenFromWebmcp: await answer('hidden_thing'),
      needsSignIn: await answer('guest_thing'),
      needsEntitlement: await answer('entitled_thing', guest([])),
      flaggedOff: await answer('flagged_thing', undefined, readFlags({ FLAG_MEDIA_SEMANTIC_SEARCH: 'off' })),
    };
    expect(new Set(Object.values(buckets)).size, JSON.stringify(buckets, null, 2)).toBe(1);
    expect(buckets.absent).toBe('not_found:That action is not available.');
  });

  it('keeps the real reason in the audit row, so masking costs no forensics', async () => {
    const ctx = context();
    await invokeForWebMcp(registry, 'guest_thing', ctx, undefined);
    const rows = ctx.audit.events;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'capability.denied', outcome: 'denied', target: { id: 'guest_thing' } });
    // The response said "not available"; the audit row says what really happened.
    expect(rows[0]?.metadata).toMatchObject({ errorCode: 'unauthenticated' });
  });

  it('still gives a caller who CAN see a tool the specific error they need', async () => {
    // A guest who holds the entitlement gets the real confirmation error, not a masked 404.
    const withConfirmation = mutation({ name: 'save_visible', confirmation: 'explicit' });
    const reg = new CapabilityRegistryImpl();
    reg.register(withConfirmation);
    const result = await invokeForWebMcp(reg, 'save_visible', context(guest(['rsvp_self'])), { value: 'v' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('confirmation_required');

    // And a visible capability's validation errors are still specific.
    const reg2 = new CapabilityRegistryImpl();
    reg2.register(cap({ name: 'strict_read', input: z.object({ value: z.string() }) }));
    const bad = await invokeForWebMcp(reg2, 'strict_read', context(), { value: 42 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('validation');
  });
});
