/**
 * Positive evidence. Everything here PASSES and is what convinced me the corresponding invariant
 * is actually upheld rather than merely asserted in a comment.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/invariants-hold.test.ts
 */
import { describe, expect, it } from 'vitest';
import { stableHash } from '@/lib/crypto';
import { ConfirmationService } from '@/policy/confirmation';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';
import { TEST_GUEST_ID, TEST_HOUSEHOLD_ID } from '@/webmcp/server/test-principal';
import { invokeForWebMcp } from '@/webmcp/server/invoke';
import type { AuthIdentityId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { registry } from '@/capabilities';
import { WEBMCP_TEST_CAPABILITIES } from '@/webmcp/server/fixtures';
import { CONFIRMATION_SECRET, as, invoke, jsonOf, key, manifest, uiInvoke } from './helpers';

const guestRef = { kind: 'guest', guestId: TEST_GUEST_ID, householdId: TEST_HOUSEHOLD_ID } as const;

/**
 * A ui-exposed twin of `webmcp_test_explicit`, registered by THIS TEST FILE.
 *
 * As of the finding-5 fix the shipped fixtures are `exposure.ui: false` and live in the bridge's
 * own registry, so `/api/capabilities/*` cannot see them — which is exactly the point of that fix.
 * But invariant 3's evidence depends on redeeming a token on the `ui` surface ("the token the
 * bridge refused really was valid"), so the test provides its own ui-reachable capability rather
 * than the app shipping one. Registering from a test is fine; the finding was that a *request*
 * could do it.
 */
const UI_EXPLICIT = 'review_ui_explicit';
const explicitTwin = WEBMCP_TEST_CAPABILITIES.find((c) => c.name === 'webmcp_test_explicit');
if (!explicitTwin) throw new Error('fixture webmcp_test_explicit not found');
registry.register({ ...explicitTwin, name: UI_EXPLICIT, exposure: { ui: true, ai: false, webmcp: true } });

describe('INVARIANT 1 — surface integrity', () => {
  it('the bridge refuses to run with anything but a webmcp context (structural, not a header check)', async () => {
    await expect(
      invokeForWebMcp({ get: () => undefined }, 'site_status', { surface: 'ui' } as never, {}),
    ).rejects.toThrow('invokeForWebMcp requires a webmcp context');
  });

  it('no header, body field, query param or content type moves a call between surfaces', async () => {
    // Bridge -> tries to claim `ui` (which would make explicit confirmations redeemable).
    const forgedUi = await jsonOf(
      await invoke(
        'webmcp_test_explicit',
        { input: { value: 'x' }, surface: 'ui', ctx: { surface: 'ui' }, idempotencyKey: key() },
        { ...as('guest-fresh'), 'x-surface': 'ui', 'x-capability-surface': 'ui', 'content-type': 'application/json; charset=utf-8' },
      ),
    );
    expect(forgedUi.status).toBe(409);
    expect(forgedUi.body.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });

    // UI route -> tries to claim `webmcp` (which would cap output and hide ui-only capabilities).
    const plain = await jsonOf(await uiInvoke('site_status', { input: {} }));
    const forgedWebmcp = await jsonOf(
      await uiInvoke('site_status', { input: {}, surface: 'webmcp' }, { 'x-surface': 'webmcp', 'x-capability-surface': 'webmcp' }),
    );
    expect(forgedWebmcp.status).toBe(plain.status);
    expect(forgedWebmcp.body.data).toEqual(plain.body.data);

    // A capability the registry has but that is not exposed to webmcp is unreachable through the bridge.
    expect((await jsonOf(await invoke('webmcp_test_hidden', { input: {} }))).status).toBe(404);
  });
});

describe('INVARIANT 2 — authorization parity', () => {
  it('the principal is resolved per request; no caching across identities', async () => {
    const anon = (await jsonOf(await manifest())).body.data as { principal: { kind: string }; tools: { name: string; execution: { auth: string } }[]; fingerprint: string };
    const guest = (await jsonOf(await manifest(as('guest')))).body.data as typeof anon;
    const admin = (await jsonOf(await manifest(as('admin')))).body.data as typeof anon;
    const anonAgain = (await jsonOf(await manifest())).body.data as typeof anon;

    expect([anon.principal.kind, guest.principal.kind, admin.principal.kind]).toEqual(['anonymous', 'guest', 'admin']);
    expect(anonAgain.fingerprint).toBe(anon.fingerprint);
    expect(anon.fingerprint).not.toBe(guest.fingerprint);

    // Every tool an anonymous manifest lists really is anonymous-auth.
    for (const tool of anon.tools) expect(tool.execution.auth, tool.name).toBe('anonymous');
    const names = (m: typeof anon) => m.tools.map((t) => t.name);
    expect(names(anon)).not.toContain('webmcp_test_guest_read');
    expect(names(anon)).not.toContain('webmcp_test_admin_read');
    expect(names(guest)).not.toContain('webmcp_test_admin_read');
    expect(names(admin)).toContain('webmcp_test_admin_read');
  });

  it('an unlisted tool is not executable: anonymous -> guest tool, guest -> admin tool', async () => {
    // As of the finding-2 fix these answer with one uniform `not_found` instead of 401/403, so the
    // bridge cannot be used to confirm that a capability exists. Still refused; the audit row still
    // records the real code.
    const anonToGuest = await jsonOf(await invoke('webmcp_test_guest_read', { input: {} }));
    expect(anonToGuest.status).toBe(404);
    expect(anonToGuest.body.error).toMatchObject({ code: 'not_found' });

    const guestToAdmin = await jsonOf(await invoke('webmcp_test_admin_read', { input: {} }, as('guest')));
    expect(guestToAdmin.status).toBe(404);
    // The entitlement name is internal vocabulary and is stripped from the response.
    expect(JSON.stringify(guestToAdmin.body)).not.toContain('admin_audit');
  });
});

describe('INVARIANT 3 — a model cannot obtain or use a confirmation', () => {
  const svc = new ConfirmationService(CONFIRMATION_SECRET);

  it('a genuinely valid, ui-surface, correctly-bound token is inert on the bridge', async () => {
    const payload = { value: 'x' };
    const issued = svc.issue({ capability: UI_EXPLICIT, principalRef: guestRef, payloadHash: stableHash(payload), surface: 'ui' });

    const viaBridge = await jsonOf(
      await invoke(UI_EXPLICIT, { input: payload, confirmationToken: issued.token, idempotencyKey: key() }, as('guest-fresh')),
    );
    expect(viaBridge.status).toBe(409);
    expect(viaBridge.body.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });

    // ... and the token really was valid: the same token redeems on the ui surface.
    const guest: GuestPrincipal = {
      kind: 'guest',
      authIdentityId: 'webmcp-test-identity' as AuthIdentityId,
      guestId: TEST_GUEST_ID,
      householdId: TEST_HOUSEHOLD_ID,
      actsFor: [TEST_GUEST_ID],
      entitlements: new Set(['view_event', 'rsvp_self']),
      authenticatedAt: new Date().toISOString(),
      sessionId: 's',
    };
    setPrincipalResolver({ resolve: async () => guest });
    try {
      const viaUi = await jsonOf(await uiInvoke(UI_EXPLICIT, { input: payload, confirmationToken: issued.token, idempotencyKey: key() }));
      expect(viaUi.status, 'the token must be valid, or the bridge test above proves nothing').toBe(200);
      expect(viaUi.body.data).toEqual({ saved: true, value: 'x' });
    } finally {
      setPrincipalResolver(anonymousResolver);
    }
  });

  it('a token minted on the webmcp surface is not redeemable anywhere, and is never returned to the agent', async () => {
    const draft = await jsonOf(await invoke('webmcp_test_draft', { input: { value: 'x' } }, as('guest')));
    expect(draft.status).toBe(200);
    expect(draft.body.confirmation).toMatchObject({ requiresUi: true, summary: 'Save "x"' });
    expect((draft.body.confirmation as Record<string, unknown>).token, 'no token may reach a model').toBeUndefined();

    // Even a token forged with the real key but s:'webmcp' fails the surface check.
    const webmcpToken = svc.issue({
      capability: 'webmcp_test_explicit',
      principalRef: guestRef,
      payloadHash: stableHash({ value: 'x' }),
      surface: 'webmcp',
    });
    const verified = svc.verify(webmcpToken.token, { capability: 'webmcp_test_explicit', principalRef: guestRef, payloadHash: stableHash({ value: 'x' }) });
    expect(verified.ok).toBe(false);
    expect(verified.ok === false && verified.error.details).toMatchObject({ reason: 'requires_ui' });
  });

  it('a forged signature, a rebound payload and a rebound principal are all refused', () => {
    const payload = { value: 'x' };
    const claims = { capability: 'webmcp_test_explicit', principalRef: guestRef, payloadHash: stableHash(payload) };
    const good = svc.issue({ ...claims, surface: 'ui' });
    const [encoded] = good.token.split('.');
    const forged = `${encoded}.${'A'.repeat(43)}`;
    const bad = svc.verify(forged, claims);
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error.details).toMatchObject({ reason: 'signature' });

    // Bound to the exact payload: a token for one payload cannot confirm another.
    const wrongPayload = svc.verify(good.token, { ...claims, payloadHash: stableHash({ value: 'y' }) });
    expect(wrongPayload.ok === false && wrongPayload.error.details).toMatchObject({ reason: 'payload' });
    // ... and to the principal.
    const wrongPrincipal = svc.verify(good.token, { ...claims, principalRef: { kind: 'anonymous' } });
    expect(wrongPrincipal.ok === false && wrongPrincipal.error.details).toMatchObject({ reason: 'principal' });
  });

  it('a confirmation is single-use: redeeming the same token twice is refused', async () => {
    const payload = { value: 'replay-me' };
    const issued = svc.issue({ capability: UI_EXPLICIT, principalRef: guestRef, payloadHash: stableHash(payload), surface: 'ui' });
    const guest: GuestPrincipal = {
      kind: 'guest',
      authIdentityId: 'webmcp-test-identity' as AuthIdentityId,
      guestId: TEST_GUEST_ID,
      householdId: TEST_HOUSEHOLD_ID,
      actsFor: [TEST_GUEST_ID],
      entitlements: new Set(['view_event', 'rsvp_self']),
      authenticatedAt: new Date().toISOString(),
      sessionId: 's',
    };
    setPrincipalResolver({ resolve: async () => guest });
    try {
      const first = await jsonOf(await uiInvoke(UI_EXPLICIT, { input: payload, confirmationToken: issued.token, idempotencyKey: key() }));
      expect(first.status).toBe(200);
      // A fresh idempotency key, so this is not an honest retry — it is a second use of the nonce.
      const second = await jsonOf(await uiInvoke(UI_EXPLICIT, { input: payload, confirmationToken: issued.token, idempotencyKey: key() }));
      expect(second.status).toBe(409);
      expect(second.body.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'used' } });
    } finally {
      setPrincipalResolver(anonymousResolver);
    }
  });
});

describe('INVARIANT 4 — step-up cannot be bypassed', () => {
  it('a stale session is refused before the confirmation question is even asked', async () => {
    const stale = await jsonOf(await invoke('webmcp_test_transaction', { input: { value: 'x' }, idempotencyKey: key() }, as('guest')));
    expect(stale.status).toBe(403);
    expect(stale.body.error).toMatchObject({ code: 'step_up_required' });
  });

  it('a valid confirmation token does not paper over a stale session', async () => {
    const svc = new ConfirmationService(CONFIRMATION_SECRET);
    const payload = { value: 'x' };
    const token = svc.issue({ capability: 'webmcp_test_transaction', principalRef: guestRef, payloadHash: stableHash(payload), surface: 'ui' }).token;
    const stale = await jsonOf(await invoke('webmcp_test_transaction', { input: payload, confirmationToken: token, idempotencyKey: key() }, as('guest')));
    expect(stale.status).toBe(403);
    expect(stale.body.error).toMatchObject({ code: 'step_up_required' });
  });

  it('a fresh session still cannot commit a transaction from an agent', async () => {
    const fresh = await jsonOf(await invoke('webmcp_test_transaction', { input: { value: 'x' }, idempotencyKey: key() }, as('guest-fresh')));
    expect(fresh.status).toBe(409);
    expect(fresh.body.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
  });
});

describe('INVARIANT 5 — idempotency semantics', () => {
  it('refuses a key from an anonymous principal', async () => {
    const keyed = await jsonOf(await invoke('webmcp_test_external', { input: { value: 'x' }, idempotencyKey: key() }));
    expect(keyed.status).toBe(422);
    expect((keyed.body.error as { details: { issues: { path: string }[] } }).details.issues[0]!.path).toBe('idempotencyKey');
  });

  it('replays on the same key + payload and conflicts on the same key + different payload', async () => {
    // `webmcp_test_agent_action` rather than `webmcp_test_action`: as of the finding-1 fix an
    // `inline` mutation is upgraded to `explicit` on this surface and cannot complete from an
    // agent at all, so idempotency has to be exercised on the descriptor that opts out
    // (`agentConfirmable: true`) — the only shape that still executes unattended.
    const k = key();
    const first = await jsonOf(await invoke('webmcp_test_agent_action', { input: { value: 'once' }, idempotencyKey: k }, as('guest')));
    expect(first.status).toBe(200);
    const replay = await jsonOf(await invoke('webmcp_test_agent_action', { input: { value: 'once' }, idempotencyKey: k }, as('guest')));
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const conflict = await jsonOf(await invoke('webmcp_test_agent_action', { input: { value: 'other' }, idempotencyKey: k }, as('guest')));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: 'conflict' });
  });

  it('keys are scoped per principal, so one identity cannot poison another', async () => {
    const k = key();
    await invoke('webmcp_test_agent_action', { input: { value: 'guest-value' }, idempotencyKey: k }, as('guest'));
    // The admin principal shares the key string but not the scope; it is refused (uniformly, as of
    // finding 2, because it cannot see this tool), never with the guest's replayed answer.
    const admin = await jsonOf(await invoke('webmcp_test_agent_action', { input: { value: 'x' }, idempotencyKey: k }, as('admin')));
    expect(admin.status).toBe(404);
    expect(JSON.stringify(admin.body)).not.toContain('guest-value');
  });
});

describe('INVARIANT 7 — body cap and cap ordering', () => {
  it('rejects an over-cap body with 64 KB, after the limiter and without buffering it', async () => {
    const over = await jsonOf(await invoke('site_status', JSON.stringify({ input: { pad: 'x'.repeat(70 * 1024) } })));
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'validation', details: { maxBytes: 65536 } });
  });

  it('enforces maxOutputChars on this surface', async () => {
    const big = await jsonOf(await invoke('webmcp_test_big', { input: {} }));
    expect(big.status).toBe(422);
    expect((big.body.error as { details: Record<string, unknown> }).details).toMatchObject({ maxOutputChars: 50 });
  });
});

describe('INVARIANT 8 — CSRF / cross-origin', () => {
  const post = (headers: Record<string, string>) =>
    invoke('site_status', { input: {} }, { ...headers, 'x-forwarded-for': `10.44.${Math.floor(Math.random() * 250)}.1` });

  it('refuses a cross-site JSON POST even though it is anonymous', async () => {
    const cross = await jsonOf(
      await post({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }),
    );
    expect(cross.status).toBe(403);
    expect(cross.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } });
  });

  it('refuses a request with no origin metadata at all', async () => {
    const bare = await jsonOf(await post({ 'content-type': 'application/json', 'sec-fetch-site': '' }));
    expect(bare.status).toBe(403);
  });

  it('refuses every content type that would skip a CORS preflight', async () => {
    for (const contentType of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      const response = await jsonOf(await post({ 'content-type': contentType, 'sec-fetch-site': 'same-origin' }));
      expect({ contentType, status: response.status }).toEqual({ contentType, status: 403 });
      expect(response.body.error).toMatchObject({ details: { reason: 'content_type' } });
    }
  });

  it('refuses a same-site (sibling subdomain) request', async () => {
    const sameSite = await jsonOf(await post({ 'content-type': 'application/json', 'sec-fetch-site': 'same-site' }));
    expect(sameSite.status).toBe(403);
  });

  it('protects the personalized manifest cross-site and never lets it be cached', async () => {
    const cross = await manifest({ ...as('guest'), 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const ok = await manifest(as('guest'));
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('INVARIANT 9 — entitlement names and internals stay server-side', () => {
  it('never returns details.missing, and returns a guest-safe message', async () => {
    const forbidden = await jsonOf(await invoke('webmcp_test_admin_read', { input: {} }, as('guest')));
    expect(JSON.stringify(forbidden.body)).not.toMatch(/admin_audit|missing/);
    // Finding 2: the reply is the uniform "not available" rather than `forbidden`, so it leaks
    // neither the entitlement name nor the capability's existence.
    expect(forbidden.body.error).toEqual({ code: 'not_found', message: 'That action is not available.' });
  });
});

describe('INVARIANT 7 — the limiter really does run before the body is read', () => {
  it('an exhausted bucket answers 429 to an over-cap body, never 422', async () => {
    const victim = '203.0.113.200';
    let sawRateLimit = false;
    for (let i = 0; i < 70 && !sawRateLimit; i++) {
      const r = await invoke('site_status', { input: {} }, { 'x-forwarded-for': victim });
      sawRateLimit = r.status === 429;
    }
    expect(sawRateLimit).toBe(true);
    // 70 KB body against an exhausted bucket: refused on the limiter, so it is never streamed in.
    const over = await invoke('site_status', JSON.stringify({ input: { pad: 'x'.repeat(70 * 1024) } }), { 'x-forwarded-for': victim });
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBeTruthy();
  });
});

describe('kill switch — FLAG_WEBMCP is enforced server-side on every request', () => {
  it('turns both routes off at runtime without a redeploy', async () => {
    const previous = process.env.FLAG_WEBMCP;
    process.env.FLAG_WEBMCP = 'off';
    try {
      const m = await jsonOf(await manifest(as('guest')));
      expect(m.status).toBe(404);
      expect(m.body.error).toMatchObject({ code: 'feature_disabled' });
      const i = await jsonOf(await invoke('site_status', { input: {} }));
      expect(i.status).toBe(404);
      expect(i.body.error).toMatchObject({ code: 'feature_disabled' });
    } finally {
      if (previous === undefined) delete process.env.FLAG_WEBMCP;
      else process.env.FLAG_WEBMCP = previous;
    }
  });
});
