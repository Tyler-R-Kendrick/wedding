/** Second scratch probe: IP derivation, body cap, confirmation-token behaviour. */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POST as INVOKE } from '@/app/api/webmcp/invoke/[name]/route';
import { GET as MANIFEST } from '@/app/api/webmcp/manifest/route';
import { getClientIp } from '@/lib/request';
import { ConfirmationService } from '@/policy/confirmation';
import { stableHash } from '@/lib/crypto';
import { TEST_GUEST_ID, TEST_HOUSEHOLD_ID } from '@/webmcp/server/test-principal';

const SECRET = 'review-k-test-auth-secret-0123456789';
const SAME_ORIGIN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } as const;
const as = (kind: string) => ({ 'x-test-principal': kind, 'x-test-auth': SECRET });

const invoke = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  INVOKE(
    new Request(`http://localhost:3000/api/webmcp/invoke/${name}`, {
      method: 'POST',
      headers: { ...SAME_ORIGIN, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );

describe('probe 2', () => {
  it('dumps IP derivation, body cap and confirmation behaviour', async () => {
    const out: Record<string, unknown> = {};

    const h = (init: Record<string, string>) => new Headers(init);
    out.ip = {
      hops0_xff: getClientIp(h({ 'x-forwarded-for': '1.2.3.4' }), 0),
      hops0_none: getClientIp(h({}), 0),
      hops1_xff: getClientIp(h({ 'x-forwarded-for': '1.2.3.4' }), 1),
      hops1_xff_chain: getClientIp(h({ 'x-forwarded-for': 'evil, 5.6.7.8' }), 1),
      hops1_vercel: getClientIp(h({ 'x-vercel-forwarded-for': 'attacker-chosen-1', 'x-forwarded-for': '5.6.7.8' }), 1),
      hops1_vercel_list: getClientIp(h({ 'x-vercel-forwarded-for': 'a,b,attacker-chosen-2' }), 1),
      hops1_none: getClientIp(h({}), 1),
    };

    // body cap
    const big = 'x'.repeat(70 * 1024);
    const overCap = await invoke('site_status', JSON.stringify({ input: { pad: big } }), { 'x-forwarded-for': '10.5.5.1' });
    out.overCap = { status: overCap.status, body: await overCap.json() };

    // a genuinely valid, UI-surface confirmation token for the test guest
    const svc = new ConfirmationService('review-k-confirmation-secret-0123456789');
    const payload = { value: 'x' };
    const issued = svc.issue({
      capability: 'webmcp_test_explicit',
      principalRef: { kind: 'guest', guestId: TEST_GUEST_ID, householdId: TEST_HOUSEHOLD_ID },
      payloadHash: stableHash(payload),
      surface: 'ui',
    });
    out.tokenIssued = { expiresAt: issued.expiresAt, len: issued.token.length };

    const withToken = await invoke(
      'webmcp_test_explicit',
      { input: payload, confirmationToken: issued.token, idempotencyKey: '01JABCDEFGHJKMNPQRSTVWXY41' },
      { ...as('guest-fresh'), 'x-forwarded-for': '10.5.5.2' },
    );
    out.explicitWithValidUiToken = { status: withToken.status, body: await withToken.json() };

    // manifest cross-site for a signed-in principal
    const cross = await MANIFEST(
      new Request('http://localhost:3000/api/webmcp/manifest', {
        headers: { ...as('guest'), 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'x-forwarded-for': '10.5.5.3' },
      }),
    );
    out.manifestCrossSiteGuest = { status: cross.status, body: await cross.json() };

    const crossAnon = await MANIFEST(
      new Request('http://localhost:3000/api/webmcp/manifest', {
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', 'x-forwarded-for': '10.5.5.4' },
      }),
    );
    const crossAnonBody = await crossAnon.json();
    out.manifestCrossSiteAnon = {
      status: crossAnon.status,
      headers: Object.fromEntries(crossAnon.headers.entries()),
      tools: crossAnonBody.data?.tools?.map((t: { name: string }) => t.name),
    };

    // inline-confirmation action from an agent: executable?
    const action = await invoke(
      'webmcp_test_action',
      { input: { value: 'hello' }, idempotencyKey: 'caller-chosen-not-a-ulid' },
      { ...as('guest'), 'x-forwarded-for': '10.5.5.5' },
    );
    out.inlineAction = { status: action.status, body: await action.json() };

    const replay = await invoke(
      'webmcp_test_action',
      { input: { value: 'hello' }, idempotencyKey: 'caller-chosen-not-a-ulid' },
      { ...as('guest'), 'x-forwarded-for': '10.5.5.6' },
    );
    out.inlineActionReplay = { status: replay.status, body: await replay.json() };

    const conflict = await invoke(
      'webmcp_test_action',
      { input: { value: 'DIFFERENT' }, idempotencyKey: 'caller-chosen-not-a-ulid' },
      { ...as('guest'), 'x-forwarded-for': '10.5.5.7' },
    );
    out.inlineActionConflict = { status: conflict.status, body: await conflict.json() };

    writeFileSync('review-K/probe2-output.json', JSON.stringify(out, null, 2));
    expect(true).toBe(true);
  });
});
