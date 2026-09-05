import { describe, expect, it } from 'vitest';
import { classifyUberResponse, UberVouchersTransportBenefit, uberConfigFromEnv } from '@/providers/transport-benefit';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const config = { clientId: 'id', clientSecret: 'secret', organizationId: 'org', programId: 'prog', apiBaseUrl: 'https://sandbox.example' };

function adapter(handler: Handler, opts: { timeoutMs?: number } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { p: new UberVouchersTransportBenefit(config, { fetch: fetchImpl, timeoutMs: opts.timeoutMs }), calls };
}

const token = () => json(200, { access_token: 'tok', expires_in: 3600 });
const req = { claimId: 'CLAIM1', guestId: 'G', entitlementId: 'E' };

describe('Uber Vouchers adapter (contract)', () => {
  it('validates configuration by name, never value', () => {
    const missing = uberConfigFromEnv({ UBER_CLIENT_ID: 'x' });
    expect(!missing.ok && missing.error).toEqual(['UBER_CLIENT_SECRET', 'UBER_ORG_ID', 'UBER_VOUCHER_PROGRAM_ID']);
    const ok = uberConfigFromEnv({ UBER_CLIENT_ID: 'a', UBER_CLIENT_SECRET: 'b', UBER_ORG_ID: 'c', UBER_VOUCHER_PROGRAM_ID: 'd' });
    expect(ok.ok).toBe(true);
    const p = new UberVouchersTransportBenefit({ ...config, clientSecret: '' });
    expect(p.validateConfig()).toMatchObject({ ok: false, missing: ['UBER_CLIENT_SECRET'] });
    expect(JSON.stringify(p.validateConfig())).not.toContain('secret');
  });

  it('fetches a token once, creates a voucher for our claim id, and returns an allowlisted redemption link', async () => {
    const { p, calls } = adapter((url, init) => {
      if (url.includes('/oauth/')) return token();
      if (init.method === 'GET') return json(404, { message: 'not found' });
      return json(201, { id: 'v_1', redemption_link: 'https://www.uber.com/redeem/ABC', expires_at: '2027-07-18T05:00:00Z' });
    });
    const r = await p.createVoucherClaim(req);
    expect(r.ok && r.value).toEqual({ claimId: 'CLAIM1', providerRef: 'v_1', redemptionLink: 'https://www.uber.com/redeem/ABC', expiresAt: '2027-07-18T05:00:00.000Z' });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST']);
    expect(calls[0]!.url).toBe('https://auth.uber.com/oauth/v2/token');
    expect(calls[2]!.url).toBe('https://sandbox.example/v1/organizations/org/voucher-programs/prog/vouchers');
    expect(JSON.parse(calls[2]!.body!)).toMatchObject({ external_reference: 'CLAIM1', quantity: 1 });
    // Second call reuses the cached token.
    await p.getRedemptionLink({ providerRef: 'v_1' });
    expect(calls.filter((c) => c.url.includes('/oauth/'))).toHaveLength(1);
  });

  it('is idempotent at the provider: an existing voucher for the claim id is returned, never duplicated', async () => {
    const { p, calls } = adapter((url, init) => (url.includes('/oauth/') ? token() : init.method === 'GET' ? json(200, { voucher_id: 'v_existing', link: 'https://www.uber.com/redeem/EXISTING' }) : json(500, {})));
    const r = await p.createVoucherClaim(req);
    expect(r.ok && r.value.providerRef).toBe('v_existing');
    expect(calls.some((c) => c.method === 'POST' && !c.url.includes('/oauth/'))).toBe(false);
  });

  it('classifies 4xx / 5xx / 429 (with Retry-After) into provider failures with guest-safe messages', async () => {
    expect(classifyUberResponse(401)).toBe('auth');
    expect(classifyUberResponse(404)).toBe('not_found');
    expect(classifyUberResponse(429)).toBe('rate_limited');
    expect(classifyUberResponse(503)).toBe('server');
    expect(classifyUberResponse(400)).toBe('bad_request');
    const rate = adapter((url, init) => (url.includes('/oauth/') ? token() : init.method === 'GET' ? json(404, {}) : json(429, { error: 'slow down' }, { 'retry-after': '7' })));
    const r = await rate.p.createVoucherClaim(req);
    expect(!r.ok && r.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 7000, provider: 'uber-vouchers' });
    expect(!r.ok && r.error.message).not.toMatch(/slow down/);
    const server = adapter((url) => (url.includes('/oauth/') ? token() : json(503, { detail: 'db down' })));
    const s = await server.p.createVoucherClaim(req);
    expect(!s.ok && s.error.class).toBe('server');
    const auth = adapter(() => json(401, { error: 'invalid_client' }));
    const a = await auth.p.createVoucherClaim(req);
    expect(!a.ok && a.error.class).toBe('auth');
    const bad = adapter((url, init) => (url.includes('/oauth/') ? token() : init.method === 'GET' ? json(404, {}) : json(400, { error: 'bad' })));
    const b = await bad.p.createVoucherClaim(req);
    expect(!b.ok && b.error.class).toBe('bad_request');
  });

  it('rejects malformed responses and redemption links off the allowlist', async () => {
    const notJson = adapter((url) => (url.includes('/oauth/') ? token() : new Response('<html>', { status: 200 })));
    const n = await notJson.p.createVoucherClaim(req);
    expect(!n.ok && n.error.class).toBe('malformed_response');
    const noLink = adapter((url, init) => (url.includes('/oauth/') ? token() : init.method === 'GET' ? json(404, {}) : json(201, { id: 'v' })));
    const l = await noLink.p.createVoucherClaim(req);
    expect(!l.ok && l.error.class).toBe('malformed_response');
    const evil = adapter((url, init) => (url.includes('/oauth/') ? token() : init.method === 'GET' ? json(404, {}) : json(201, { id: 'v', redemption_link: 'https://evil.example/redeem' })));
    const e = await evil.p.createVoucherClaim(req);
    expect(!e.ok && e.error.class).toBe('malformed_response');
    const noToken = adapter(() => json(200, { nope: true }));
    const t = await noToken.p.createVoucherClaim(req);
    expect(!t.ok && t.error.class).toBe('malformed_response');
    const huge = adapter((url) => (url.includes('/oauth/') ? token() : new Response('x'.repeat(300 * 1024), { status: 200, headers: { 'content-type': 'application/json' } })));
    const h = await huge.p.createVoucherClaim(req);
    expect(!h.ok && h.error.class).toBe('malformed_response');
  });

  it('times out and reports network failures without throwing', async () => {
    const slow = adapter((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))), { timeoutMs: 20 });
    const r = await slow.p.createVoucherClaim(req);
    expect(!r.ok && r.error.class).toBe('timeout');
    const down = adapter(() => {
      throw new TypeError('fetch failed');
    });
    const d = await down.p.createVoucherClaim(req);
    expect(!d.ok && d.error.class).toBe('network');
    expect((await down.p.health()).status).toBe('down');
  });
});
