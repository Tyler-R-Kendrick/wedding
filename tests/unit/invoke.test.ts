import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { invoke } from '@/capabilities/invoke';
import { MemoryIdempotencyStore } from '@/capabilities/services';
import { defineCapability, type CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { readFlags } from '@/contracts/flags';
import type { AuthIdentityId, GuestId, HouseholdId, IdempotencyKey } from '@/contracts/ids';
import type { GuestPrincipal, Principal } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { MemoryAuditSink } from '@/lib/audit';
import { keyedHash, stableHash } from '@/lib/crypto';
import { ConfirmationService } from '@/policy/confirmation';

const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'A' as AuthIdentityId,
  guestId: 'G1' as GuestId,
  householdId: 'H1' as HouseholdId,
  actsFor: ['G1' as GuestId],
  entitlements: new Set(['rsvp_self']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

const confirmation = new ConfirmationService('invoke-test-secret-1234567');

function ctx(over: Partial<CapabilityContext> = {}, services: Record<string, unknown> = {}) {
  const audit = new MemoryAuditSink();
  const c: CapabilityContext = {
    principal: { kind: 'anonymous' },
    requestId: 'req-1',
    now: new Date(),
    flags: readFlags({}),
    audit,
    inputTrust: 'TRUSTED_WEDDING',
    services: { confirmation, idempotency: new MemoryIdempotencyStore(), ...services },
    ...over,
  };
  return { c, audit };
}

const echo = defineCapability<{ text: string }, { text: string }>({
  name: 'echo_text',
  title: 'Echo',
  description: 'test',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: false },
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string() }),
  maxOutputChars: 40,
  handler: async (_c, i) => ok({ data: { text: i.text }, sources: [] }),
});

describe('invoke pipeline', () => {
  it('returns validation errors with field issues and audits them as failed', async () => {
    const { c, audit } = ctx();
    const r = await invoke(echo, c, { text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation');
      expect(r.error.details?.issues).toEqual([{ path: 'text', message: expect.any(String) }]);
    }
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ action: 'capability.failed', outcome: 'failed', target: { type: 'capability', id: 'echo_text' } });
  });

  it('audits denials as capability.denied with the error code', async () => {
    const gated = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'guest_only', auth: 'guest', requires: ['manage_household_rsvp'] });
    const { c, audit } = ctx({ principal: guest });
    const r = await invoke(gated, c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
    expect(audit.events[0]).toMatchObject({ action: 'capability.denied', outcome: 'denied', metadata: { errorCode: 'forbidden' } });
    const anon = ctx();
    const r2 = await invoke(gated, anon.c, { text: 'hi' });
    if (!r2.ok) expect(r2.error.code).toBe('unauthenticated');
  });

  it('audits success with the request id and surface, never the input', async () => {
    const { c, audit } = ctx({ surface: 'ui' });
    const r = await invoke(echo, c, { text: 'hello' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.data).toEqual({ text: 'hello' });
    const e = audit.events[0]!;
    expect(e).toMatchObject({ action: 'capability.invoked', outcome: 'success', requestId: 'req-1', metadata: { surface: 'ui', kind: 'read' } });
    expect(JSON.stringify(e)).not.toContain('hello');
    expect(e.metadata).not.toHaveProperty('inputHash'); // reads record no fingerprint at all
  });

  it('records a keyed input fingerprint for consequential capabilities only, and none without a key', async () => {
    const action = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'hashed_action', kind: 'action', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    const key = 'audit-key-0123456789abcdef';
    const keyed = ctx({}, { hashInput: (v: unknown) => keyedHash(key, v) });
    expect((await invoke(action, keyed.c, { text: 'hello' })).ok).toBe(true);
    const hash = keyed.audit.events[0]!.metadata?.inputHash;
    expect(hash).toBe(keyedHash(key, { text: 'hello' }));
    expect(hash).not.toBe(stableHash({ text: 'hello' })); // not an unkeyed digest anyone can precompute
    const read = ctx({}, { hashInput: (v: unknown) => keyedHash(key, v) });
    await invoke(echo, read.c, { text: 'hello' });
    expect(read.audit.events[0]!.metadata).not.toHaveProperty('inputHash');
    const unkeyed = ctx();
    await invoke(action, unkeyed.c, { text: 'hello' });
    expect(unkeyed.audit.events[0]!.metadata).not.toHaveProperty('inputHash');
  });

  it('caps output size for AI/WebMCP surfaces only', async () => {
    const big = { text: 'x'.repeat(100) };
    const ai = ctx({ surface: 'ai' });
    const r = await invoke(echo, ai.c, big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details).toMatchObject({ maxOutputChars: 40 });
    const ui = ctx({ surface: 'ui' });
    expect((await invoke(echo, ui.c, big)).ok).toBe(true);
  });

  it('caps a REPLAYED outcome too: a ui result may not reach an agent past the cap', async () => {
    // The replay return is upstream of step 8, so before review N2 it skipped every check there.
    // One idempotency scope is shared by all surfaces on purpose — adding the surface to the key
    // would let one key run the handler once per surface — so the cap has to be applied on the way
    // out instead. `agent_echo` is exposed to ui, ai and webmcp so one key can cross between them.
    const shared = new MemoryIdempotencyStore();
    const key = 'replay-cap-key-0123456789' as IdempotencyKey;
    const agentEcho = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'agent_echo',
      kind: 'action',
      idempotent: true,
      exposure: { ui: true, ai: true, webmcp: true },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
    });
    const big = { text: 'x'.repeat(100) };
    const ui = ctx({ surface: 'ui', principal: guest, idempotencyKey: key }, { idempotency: shared });
    const first = await invoke(agentEcho, ui.c, big);
    expect(first.ok, 'the ui call itself is uncapped and stores its outcome').toBe(true);

    for (const surface of ['ai', 'webmcp'] as const) {
      const replay = ctx({ surface, principal: guest, idempotencyKey: key }, { idempotency: shared });
      const r = await invoke(agentEcho, replay.c, big);
      expect(r.ok, `${surface} must not receive the oversized stored result`).toBe(false);
      if (!r.ok) expect(r.error.details).toMatchObject({ maxOutputChars: 40 });
    }
    // A replay that fits still replays: the cap is the only thing added, not a blanket refusal.
    const smallKey = 'replay-ok-key-0123456789' as IdempotencyKey;
    const small = { text: 'ok' };
    const uiSmall = ctx({ surface: 'ui', principal: guest, idempotencyKey: smallKey }, { idempotency: shared });
    expect((await invoke(agentEcho, uiSmall.c, small)).ok).toBe(true);
    const aiSmall = ctx({ surface: 'ai', principal: guest, idempotencyKey: smallKey }, { idempotency: shared });
    const replayed = await invoke(agentEcho, aiSmall.c, small);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.value.data).toEqual({ text: 'ok' });
  });

  it('hides capabilities not exposed on the calling surface', async () => {
    const { c } = ctx({ surface: 'webmcp' });
    const r = await invoke(echo, c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });

  it('returns feature_disabled when the flag is off, and fails closed for readiness-gated flags', async () => {
    const flagged = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'flagged', flag: 'AI_CONCIERGE' });
    const off = ctx({ flags: readFlags({ FLAG_AI_CONCIERGE: 'off' }) });
    const r = await invoke(flagged, off.c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('feature_disabled');
    expect((await invoke(flagged, ctx().c, { text: 'hi' })).ok).toBe(true);

    const bio = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'bio', flag: 'BIOMETRICS_ENABLED' });
    const flagOn = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on' });
    const noReadiness = ctx({ flags: flagOn });
    expect((await invoke(bio, noReadiness.c, { text: 'hi' })).ok).toBe(false);
    const notReady = ctx({ flags: flagOn }, { readiness: async () => false });
    expect((await invoke(bio, notReady.c, { text: 'hi' })).ok).toBe(false);
    const ready = ctx({ flags: flagOn }, { readiness: async () => true });
    expect((await invoke(bio, ready.c, { text: 'hi' })).ok).toBe(true);
  });

  it('enforces step-up freshness for transactions', async () => {
    const tx = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'claim_thing',
      kind: 'transaction',
      auth: 'guest',
      stepUp: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    });
    const stale = ctx({ principal: { ...guest, authenticatedAt: '2020-01-01T00:00:00Z' } });
    const r = await invoke(tx, stale.c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('step_up_required');
    expect((await invoke(tx, ctx({ principal: guest }).c, { text: 'hi' })).ok).toBe(true);
  });

  it('refuses an inline mutation off the website, but not an inline handoff', async () => {
    // `inline` means "the form asks before it acts", and off the UI surface there is no form. This
    // guarantee was `explicit`-only until level 12; the concierge then began deriving a tool list
    // from `exposure.ai`, and four AI-exposed mutations are `inline` — one of them
    // (`delete_my_travel_profile`) requiring no input at all, so the router could plan it from a
    // sentence. Nothing but a strict input schema stood between a guest typing "please delete my
    // travel profile" and the deletion.
    const base = { ...echo, kind: 'action' as const, auth: 'guest' as const, exposure: { ui: true, ai: true, webmcp: true }, annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } };
    const inline = defineCapability<{ text: string }, { text: string }>({ ...base, name: 'inline_thing', confirmation: 'inline' });
    const explicit = defineCapability<{ text: string }, { text: string }>({ ...base, name: 'explicit_thing', confirmation: 'explicit' });
    for (const surface of ['ai', 'webmcp'] as const) {
      for (const action of [inline, explicit]) {
        const r = await invoke(action, ctx({ principal: guest, surface }).c, { text: 'hi' });
        expect(r.ok, `${action.name} on ${surface}`).toBe(false);
        if (!r.ok) expect(r.error, `${action.name} on ${surface}`).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
      }
    }
    // On the website `inline` still needs no token — the form is the confirmation.
    expect((await invoke(inline, ctx({ principal: guest }, { idempotency: new MemoryIdempotencyStore() }).c, { text: 'hi' })).ok).toBe(true);

    // The opt-out is opt-IN: a descriptor that says nothing is still refused. This is the security
    // property — `agentConfirmable` has to be typed out deliberately, per capability, by someone
    // who has thought about an agent completing it with nobody watching.
    const optedOut = defineCapability<{ text: string }, { text: string }>({ ...base, name: 'opted_out_thing', confirmation: 'inline', agentConfirmable: true });
    expect((await invoke(optedOut, ctx({ principal: guest, surface: 'ai' }, { idempotency: new MemoryIdempotencyStore() }).c, { text: 'hi' })).ok).toBe(true);
    const explicitOptOut = defineCapability<{ text: string }, { text: string }>({ ...base, name: 'explicit_opt_out', confirmation: 'explicit', agentConfirmable: true });
    const stillRefused = await invoke(explicitOptOut, ctx({ principal: guest, surface: 'ai' }).c, { text: 'hi' });
    expect(stillRefused.ok, 'agentConfirmable must never relax explicit confirmation').toBe(false);

    // A TRANSACTION is never relaxable, on any surface. The contract says so and this is where it
    // has to hold: the WebMCP layer re-upgrades a transaction on its own surface, but `ai` has no
    // such belt, so the pipeline is the only thing standing between an agent and a committed
    // transaction. Found by an adversarial review of the integrated level; before the fix this
    // returned ok on surface `ai`.
    const txn = defineCapability<{ text: string }, { text: string }>({
      ...base,
      name: 'txn_opt_out',
      kind: 'transaction',
      confirmation: 'inline',
      agentConfirmable: true,
      // `defineCapability` refuses a transaction without step-up, which is a belt of its own — so
      // the attack needs a guest who signed in recently, and `guest` above is authenticated now.
      stepUp: true,
    });
    for (const surface of ['ai', 'webmcp'] as const) {
      const r = await invoke(txn, ctx({ principal: guest, surface }, { idempotency: new MemoryIdempotencyStore() }).c, { text: 'hi' });
      expect(r.ok, `agentConfirmable must never relax a transaction (${surface})`).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
    }

    // An `external` handoff commits nothing: it returns a provider URL and logs that it did, and
    // level 09 exposes the gift and reservation links to an assistant on purpose. The guest's own
    // click is the commitment, so `inline` there is a UI affordance, not a safety gate.
    const handoff = defineCapability<{ text: string }, { text: string }>({ ...base, name: 'handoff_thing', kind: 'external', confirmation: 'inline' });
    expect((await invoke(handoff, ctx({ principal: guest, surface: 'ai' }).c, { text: 'hi' })).ok).toBe(true);
  });

  it('requires a matching confirmation token for explicit confirmation', async () => {
    const action = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'confirm_thing',
      kind: 'action',
      auth: 'guest',
      confirmation: 'explicit',
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    });
    const missing = ctx({ principal: guest });
    const r = await invoke(action, missing.c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('confirmation_required');

    const ref = { kind: 'guest' as const, guestId: guest.guestId, householdId: guest.householdId };
    const token = confirmation.issue({ capability: 'confirm_thing', principalRef: ref, payloadHash: stableHash({ text: 'hi' }) }).token;
    const store = new MemoryIdempotencyStore();
    const withToken = ctx({ principal: guest, confirmationToken: token }, { idempotency: store });
    expect((await invoke(action, withToken.c, { text: 'hi' })).ok).toBe(true);
    const wrongPayload = ctx({ principal: guest, confirmationToken: token }, { idempotency: store });
    expect((await invoke(action, wrongPayload.c, { text: 'other' })).ok).toBe(false);
    // A token is consumed on first use: replaying it within its TTL is refused.
    const replayed = await invoke(action, ctx({ principal: guest, confirmationToken: token }, { idempotency: store }).c, { text: 'hi' });
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'used' } });
    // Without a store to consume nonces the pipeline fails closed.
    const fresh = confirmation.issue({ capability: 'confirm_thing', principalRef: ref, payloadHash: stableHash({ text: 'hi' }) }).token;
    const noStore = await invoke(action, ctx({ principal: guest, confirmationToken: fresh }, { idempotency: undefined }).c, { text: 'hi' });
    expect(!noStore.ok && noStore.error.code).toBe('internal');
  });

  it('only completes draft -> confirm on the ui surface, and lets an honest retry replay without burning the token', async () => {
    let calls = 0;
    const action = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'confirm_ui_only',
      kind: 'action',
      auth: 'guest',
      confirmation: 'explicit',
      idempotent: true,
      exposure: { ui: true, ai: true, webmcp: true },
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
      handler: async (_c, i) => {
        calls++;
        return ok({ data: { text: i.text }, sources: [] });
      },
    });
    const ref = { kind: 'guest' as const, guestId: guest.guestId, householdId: guest.householdId };
    const token = confirmation.issue({ capability: 'confirm_ui_only', principalRef: ref, payloadHash: stableHash({ text: 'hi' }) }).token;
    const store = new MemoryIdempotencyStore();
    for (const surface of ['ai', 'webmcp'] as const) {
      const r = await invoke(action, ctx({ principal: guest, confirmationToken: token, surface }, { idempotency: store }).c, { text: 'hi' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
    }
    // Tokens drafted by the concierge (surface 'ai') are not redeemable even from the ui.
    const aiToken = confirmation.issue({ capability: 'confirm_ui_only', principalRef: ref, payloadHash: stableHash({ text: 'hi' }), surface: 'ai' }).token;
    const viaUi = await invoke(action, ctx({ principal: guest, confirmationToken: aiToken, surface: 'ui' }, { idempotency: store }).c, { text: 'hi' });
    expect(!viaUi.ok && viaUi.error.details?.reason).toBe('requires_ui');
    expect(calls).toBe(0);
    const key = 'idem-confirm-retry' as IdempotencyKey;
    const first = await invoke(action, ctx({ principal: guest, confirmationToken: token, surface: 'ui', idempotencyKey: key }, { idempotency: store }).c, { text: 'hi' });
    expect(first.ok).toBe(true);
    const retry = await invoke(action, ctx({ principal: guest, confirmationToken: token, surface: 'ui', idempotencyKey: key }, { idempotency: store }).c, { text: 'hi' });
    expect(retry.ok).toBe(true); // replayed from the idempotency store, nonce not re-checked
    expect(calls).toBe(1);
    const other = await invoke(action, ctx({ principal: guest, confirmationToken: token, surface: 'ui', idempotencyKey: 'idem-confirm-other' as IdempotencyKey }, { idempotency: store }).c, { text: 'hi' });
    expect(!other.ok && other.error.details?.reason).toBe('used');
    expect(await store.get('confirm_ui_only:guest:G1', 'idem-confirm-other')).toBeNull(); // the losing reservation was released
  });

  it('replays idempotent mutations and rejects a reused key with a different payload', async () => {
    let calls = 0;
    const mutate = defineCapability<{ text: string }, { text: string; n: number }>({
      ...echo,
      name: 'mutate_thing',
      kind: 'action',
      idempotent: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      output: z.object({ text: z.string(), n: z.number() }),
      handler: async (_c, i) => ok({ data: { text: i.text, n: ++calls }, sources: [] }),
    });
    const store = new MemoryIdempotencyStore();
    const key = 'idem-key-123' as IdempotencyKey;
    const first = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    const second = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value.data).toEqual(first.value.data);
    expect(calls).toBe(1);
    const conflict = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'b' });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('conflict');
  });

  it('requires an idempotency key and a store for idempotent mutations (fail closed)', async () => {
    let calls = 0;
    const mutate = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'required_key',
      kind: 'action',
      auth: 'guest',
      idempotent: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      handler: async (_c, i) => {
        calls++;
        return ok({ data: { text: i.text }, sources: [] });
      },
    });
    const missingKey = await invoke(mutate, ctx({ principal: guest }, { idempotency: new MemoryIdempotencyStore() }).c, { text: 'a' });
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error).toMatchObject({ code: 'validation', message: 'idempotencyKey required' });
    const missingStore = await invoke(mutate, ctx({ principal: guest, idempotencyKey: 'idem-key-abc' as IdempotencyKey }, { idempotency: undefined }).c, { text: 'a' });
    expect(!missingStore.ok && missingStore.error.code).toBe('internal');
    expect(calls).toBe(0);
    // Reads may still opt in with a key; they are never required to.
    expect((await invoke(echo, ctx({ principal: guest }, { idempotency: undefined }).c, { text: 'a' })).ok).toBe(true);
    for (const kind of ['transaction', 'external'] as const) {
      const d = defineCapability<{ text: string }, { text: string }>({ ...mutate, name: `required_${kind}`, kind, stepUp: kind === 'transaction', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } });
      const r = await invoke(d, ctx({ principal: guest }, { idempotency: new MemoryIdempotencyStore() }).c, { text: 'a' });
      expect(!r.ok && r.error.message, kind).toBe('idempotencyKey required');
    }
  });

  it('refuses idempotency keys and explicit confirmation for anonymous principals', async () => {
    const mutate = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'anon_mutation', kind: 'action', idempotent: true, annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    const keyed = await invoke(mutate, ctx({ idempotencyKey: 'idem-key-anon' as IdempotencyKey }).c, { text: 'a' });
    expect(keyed.ok).toBe(false);
    if (!keyed.ok) expect(keyed.error).toMatchObject({ code: 'validation', details: { issues: [{ path: 'idempotencyKey' }] } });
    const confirmable = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'anon_confirm', kind: 'action', confirmation: 'explicit', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } });
    const token = confirmation.issue({ capability: 'anon_confirm', principalRef: { kind: 'anonymous' }, payloadHash: stableHash({ text: 'a' }) }).token;
    const confirmed = await invoke(confirmable, ctx({ confirmationToken: token }).c, { text: 'a' });
    expect(!confirmed.ok && confirmed.error.code).toBe('forbidden');
    // Anonymous reads without a key are unaffected.
    expect((await invoke(echo, ctx().c, { text: 'a' })).ok).toBe(true);
  });

  it('reserves the idempotency key first: concurrent retries conflict while in progress, failures release it', async () => {
    let calls = 0;
    let failNext = true;
    const mutate = defineCapability<{ text: string }, { text: string; n: number }>({
      ...echo,
      name: 'reserved_thing',
      kind: 'action',
      auth: 'guest',
      idempotent: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
      output: z.object({ text: z.string(), n: z.number() }),
      handler: async (_c, i) => {
        calls++;
        if (failNext) {
          failNext = false;
          throw new Error('transient');
        }
        return ok({ data: { text: i.text, n: calls }, sources: [] });
      },
    });
    const store = new MemoryIdempotencyStore();
    const key = 'idem-key-reserved' as IdempotencyKey;
    const scope = 'reserved_thing:guest:G1';
    await store.reserve(scope, key, stableHash({ text: 'a' }));
    const busy = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.error.code).toBe('conflict');
    expect(calls).toBe(0);
    await store.release(scope, key);

    const failed = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    expect(failed.ok).toBe(false);
    expect(await store.get(scope, key)).toBeNull(); // released, not left "in progress"
    const retried = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    expect(retried.ok).toBe(true);
    expect(calls).toBe(2);
    expect(await store.get(scope, key)).toMatchObject({ status: 'complete' });
    const replay = await invoke(mutate, ctx({ principal: guest, idempotencyKey: key }, { idempotency: store }).c, { text: 'a' });
    expect(replay.ok && retried.ok && replay.value.data).toEqual(retried.ok && retried.value.data);
    expect(calls).toBe(2);
  });

  it('converts thrown handler errors into guest-safe internal errors and audits them', async () => {
    const boom = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'boom',
      handler: async () => {
        throw new Error('database password is hunter2');
      },
    });
    const { c, audit } = ctx();
    const r = await invoke(boom, c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('internal');
      expect(r.error.message).not.toContain('hunter2');
      expect(JSON.stringify(r.error.toJSON())).not.toContain('hunter2');
    }
    expect(audit.events[0]).toMatchObject({ action: 'capability.failed', outcome: 'failed' });
  });

  it('passes handler errors through unchanged', async () => {
    const nf = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'not_found_thing',
      handler: async () => err(new CapabilityError('not_found', 'No such thing.')),
    });
    const r = await invoke(nf, ctx().c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });

  it('rejects output that fails the schema', async () => {
    const bad = defineCapability<{ text: string }, { text: string }>({
      ...echo,
      name: 'bad_output',
      handler: async () => ok({ data: { text: 42 } as unknown as { text: string }, sources: [] }),
    });
    const r = await invoke(bad, ctx().c, { text: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('internal');
  });

  it('fails consequential capabilities when the audit sink fails', async () => {
    const failingAudit = { record: async () => { throw new Error('disk full'); } };
    const action = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'audited_action', kind: 'action', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    const r = await invoke(action, ctx({ audit: failingAudit }).c, { text: 'hi' });
    expect(r.ok).toBe(false);
    const read = await invoke(echo, ctx({ audit: failingAudit }).c, { text: 'hi' });
    expect(read.ok).toBe(true);
  });

  it('never lets an anonymous principal through a system-only capability', async () => {
    const sys = defineCapability<{ text: string }, { text: string }>({ ...echo, name: 'system_only', auth: 'system' });
    const principal: Principal = { kind: 'anonymous' };
    const r = await invoke(sys, ctx({ principal }).c, { text: 'hi' });
    expect(r.ok).toBe(false);
  });
});

/**
 * Level-13 review N5, fixed at level 15 by moving input validation BELOW authorization.
 *
 * The finding was small — an agent told to fix its input for a call that could never complete on
 * its surface — but the obvious fix was worse than the bug: hoisting only the confirmation refusal
 * above validation also hoists it above `authorize`, so a caller who had merely guessed a
 * capability name would learn that it exists and wants a confirmation on the website. These three
 * cases pin all three answers, because getting one right at the cost of another is the failure mode.
 */
describe('N5: error precedence — authorize, then surface, then input', () => {
  const confirmed = defineCapability<{ text: string }, { text: string }>({
    ...echo,
    name: 'confirm_text',
    kind: 'action',
    auth: 'guest',
    requires: ['manage_household_rsvp'],
    confirmation: 'explicit',
    annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  });
  const entitled: Principal = { ...guest, entitlements: new Set(['manage_household_rsvp']) };

  it('tells an unauthorized caller nothing about the capability, even about its confirmation', async () => {
    // Invalid input AND unauthorized AND a surface that could never complete it: `forbidden` must
    // win. `confirmation_required` here would confirm the name is real; `validation` would hand
    // back its input schema.
    const { c } = ctx({ principal: guest, surface: 'ai' });
    const r = await invoke(confirmed, c, { text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
    const anon = ctx({ surface: 'ai' });
    const r2 = await invoke(confirmed, anon.c, { text: '' });
    if (!r2.ok) expect(r2.error.code).toBe('unauthenticated');
  });

  it('tells an authorized agent to use the website instead of asking it to fix fields', async () => {
    const { c } = ctx({ principal: entitled, surface: 'ai' });
    const r = await invoke(confirmed, c, { text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('confirmation_required');
      expect(r.error.details).toMatchObject({ reason: 'requires_ui' });
    }
  });

  it('still validates input on the surface that can complete the call', async () => {
    // Validation moved, it did not go away: on `ui` the same bad input is still a validation error,
    // and untrusted input still never reaches a handler unparsed.
    const { c } = ctx({ principal: entitled, surface: 'ui' });
    const r = await invoke(confirmed, c, { text: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation');
      expect(r.error.details?.issues).toEqual([{ path: 'text', message: expect.any(String) }]);
    }
  });
});
