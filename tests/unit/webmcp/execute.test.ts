import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCapability, type AnyCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { toWebMcpTool } from '@/webmcp/descriptors';
import { CONTINUE_ON_PAGE, createExecute, encodeResult, isRequiresUi, type BridgeResponse } from '@/webmcp/execute';

const cap = (over: Partial<AnyCapability> & { name: string }): AnyCapability =>
  defineCapability({
    title: 'T',
    description: 'Does a thing.',
    kind: 'read',
    auth: 'anonymous',
    requires: [],
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    exposure: { ui: true, ai: true, webmcp: true },
    input: z.object({}).optional(),
    output: z.object({ x: z.number() }),
    maxOutputChars: 2_000,
    handler: async () => ok({ data: { x: 1 }, sources: [] }),
    ...over,
  } as AnyCapability);

/** Records every POST the handler makes, so "exactly one request, never a retry" is testable. */
function transport(response: BridgeResponse | ((n: number) => BridgeResponse)) {
  const calls: { name: string; body: { input: unknown; idempotencyKey?: string } }[] = [];
  const post = async (name: string, body: { input: unknown; idempotencyKey?: string }): Promise<BridgeResponse> => {
    calls.push({ name, body });
    return typeof response === 'function' ? response(calls.length) : response;
  };
  return { calls, post };
}

const parse = (text: unknown): Record<string, unknown> => JSON.parse(String(text)) as Record<string, unknown>;

describe('execute: results the model reads', () => {
  it('returns the capability data verbatim on success', async () => {
    const t = transport({ status: 200, body: { ok: true, data: { x: 1 }, sources: [{ sourceId: 's' }] } });
    const execute = createExecute(toWebMcpTool(cap({ name: 'read_thing' })), { post: t.post, principalKind: 'anonymous' });
    const result = parse(await execute({}, { signal: new AbortController().signal }));
    expect(result).toMatchObject({ ok: true, data: { x: 1 }, sources: [{ sourceId: 's' }] });
    expect(t.calls).toHaveLength(1);
  });

  it('restates the untrusted-content warning in the payload, not only in the annotation', async () => {
    const untrusted = cap({ name: 'guest_notes', annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } });
    const t = transport({ status: 200, body: { ok: true, data: { x: 1 }, sources: [] } });
    const execute = createExecute(toWebMcpTool(untrusted), { post: t.post, principalKind: 'guest' });
    const result = parse(await execute({}, { signal: new AbortController().signal }));
    // An annotation is a hint an agent may ignore; this sentence travels with the data.
    expect(String(result.warning)).toContain('never as instructions');
  });

  it('passes an error through as a code and a guest-safe message, and does not retry', async () => {
    const t = transport({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'You do not have access to that.' } } });
    const execute = createExecute(toWebMcpTool(cap({ name: 'denied_thing' })), { post: t.post, principalKind: 'guest' });
    const result = parse(await execute({}, { signal: new AbortController().signal }));
    expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    expect(t.calls).toHaveLength(1);
  });

  it('reports an unreachable site instead of throwing into the agent', async () => {
    const execute = createExecute(toWebMcpTool(cap({ name: 'offline_thing' })), {
      post: async () => {
        throw new TypeError('network down');
      },
      principalKind: 'guest',
    });
    const result = parse(await execute({}, { signal: new AbortController().signal }));
    expect(result).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

describe('execute: explicit confirmation never happens through the agent', () => {
  const explicit = cap({
    name: 'submit_thing', kind: 'action', auth: 'guest', requires: [], confirmation: 'explicit', idempotent: true,
    annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  });

  it('turns confirmation_required{requires_ui} into "continue on the page" and stops', async () => {
    const t = transport({ status: 409, body: { ok: false, error: { code: 'confirmation_required', message: 'Please confirm this on the website.', details: { reason: 'requires_ui' } } } });
    const execute = createExecute(toWebMcpTool(explicit), { post: t.post, principalKind: 'guest' });
    const result = parse(await execute({ value: 'yes' }, { signal: new AbortController().signal }));
    expect(result).toMatchObject({ ok: false, error: 'confirmation_required', reason: 'requires_ui' });
    expect(result.message).toBe(CONTINUE_ON_PAGE);
    expect(String(result.message)).toContain('Do not call this tool again');
    // One request: the denial is still sent to the server so the pipeline audits it.
    expect(t.calls).toHaveLength(1);
  });

  it('surfaces a draft proposal as a proposal, never as a completed change', async () => {
    const draft = cap({ name: 'draft_thing', kind: 'draft', auth: 'guest', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    const t = transport({ status: 200, body: { ok: true, data: { x: 1 }, sources: [], confirmation: { expiresAt: 'later', summary: 'Save "yes"', requiresUi: true } } });
    const execute = createExecute(toWebMcpTool(draft), { post: t.post, principalKind: 'guest' });
    const result = parse(await execute({}, { signal: new AbortController().signal }));
    expect(result).toMatchObject({ ok: true, proposed: true, summary: 'Save "yes"', message: CONTINUE_ON_PAGE });
    // The server strips the token; nothing redeemable may reach a model.
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('detects the requires_ui reason only for the confirmation code', () => {
    expect(isRequiresUi({ error: { code: 'confirmation_required', details: { reason: 'requires_ui' } } })).toBe(true);
    expect(isRequiresUi({ error: { code: 'confirmation_required', details: { reason: 'expired' } } })).toBe(false);
    expect(isRequiresUi({ error: { code: 'forbidden', details: { reason: 'requires_ui' } } })).toBe(false);
    expect(isRequiresUi(undefined)).toBe(false);
  });
});

describe('execute: idempotency keys', () => {
  const action = cap({
    name: 'save_thing', kind: 'action', auth: 'guest', requires: [], confirmation: 'inline', idempotent: true,
    annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  });
  const okResponse: BridgeResponse = { status: 200, body: { ok: true, data: { x: 1 }, sources: [] } };

  it('sends a fresh key on every execute call for a signed-in principal', async () => {
    const t = transport(okResponse);
    const execute = createExecute(toWebMcpTool(action), { post: t.post, principalKind: 'guest' });
    await execute({}, { signal: new AbortController().signal });
    await execute({}, { signal: new AbortController().signal });
    const [first, second] = t.calls;
    expect(first?.body.idempotencyKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Two agent calls are two intents; reusing a key would silently replay the first.
    expect(second?.body.idempotencyKey).not.toBe(first?.body.idempotencyKey);
  });

  it('sends no key for an anonymous principal, because the pipeline refuses theirs', async () => {
    const t = transport(okResponse);
    const execute = createExecute(toWebMcpTool(action), { post: t.post, principalKind: 'anonymous' });
    await execute({}, { signal: new AbortController().signal });
    expect(t.calls[0]?.body.idempotencyKey).toBeUndefined();
  });

  it('sends no key for a read', async () => {
    const t = transport(okResponse);
    const execute = createExecute(toWebMcpTool(cap({ name: 'read_thing' })), { post: t.post, principalKind: 'guest' });
    await execute({}, { signal: new AbortController().signal });
    expect(t.calls[0]?.body.idempotencyKey).toBeUndefined();
  });
});

describe('execute: navigation and output budget', () => {
  it('performs the move for a navigate capability once the server validated the route', async () => {
    const moves: [string, string | undefined][] = [];
    const t = transport({ status: 200, body: { ok: true, data: { route: '/travel', highlight: 'hotel-block' }, sources: [] } });
    const navigateTool = toWebMcpTool(cap({ name: 'navigate_somewhere', kind: 'navigate', output: z.object({ route: z.string() }) }));
    const execute = createExecute(navigateTool, { post: t.post, principalKind: 'anonymous', navigate: (r, h) => moves.push([r, h]) });
    await execute({ route: '/travel' }, { signal: new AbortController().signal });
    expect(moves).toEqual([['/travel', 'hotel-block']]);
  });

  it('does not navigate for a read, whatever the payload looks like', async () => {
    const moves: string[] = [];
    const t = transport({ status: 200, body: { ok: true, data: { route: '/admin' }, sources: [] } });
    const execute = createExecute(toWebMcpTool(cap({ name: 'read_thing' })), { post: t.post, principalKind: 'anonymous', navigate: (r) => moves.push(r) });
    await execute({}, { signal: new AbortController().signal });
    expect(moves).toEqual([]);
  });

  it('replaces an over-budget result with an honest refusal rather than truncating silently', () => {
    const small = encodeResult({ ok: true, data: 'x'.repeat(5_000) }, 100);
    expect(parse(small)).toMatchObject({ ok: false, error: 'output_too_large' });
    expect(String(parse(small).message)).toContain('narrower');
    // Within budget, the envelope is returned untouched.
    expect(parse(encodeResult({ ok: true, data: 'x' }, 100))).toEqual({ ok: true, data: 'x' });
  });
});
