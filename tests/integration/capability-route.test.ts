import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { POST } from '@/app/api/capabilities/[name]/route';
import { registry } from '@/capabilities';
import { defineCapability } from '@/contracts/capability';
import type { AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { getDb } from '@/db/client';
import { listAuditEvents } from '@/lib/audit';
import { publicEnv } from '@/lib/env.public';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';
import { getProvider } from '@/providers/registry';

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
const asGuest = { 'x-test-principal': 'guest' };
const url = (name: string) => `http://localhost:3000/api/capabilities/${name}`;
const params = (name: string) => ({ params: Promise.resolve({ name }) });
const post = (name: string, init: RequestInit = {}) => POST(new Request(url(name), { method: 'POST', ...init }), params(name));
const json = (body: unknown, headers: Record<string, string> = {}) => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

beforeAll(() => {
  setPrincipalResolver({ resolve: async (req) => (req.headers.get('x-test-principal') === 'guest' ? guest : { kind: 'anonymous' }) });
  registry.register(
    defineCapability<unknown, { ok: boolean }>({
      name: 'route_test_household',
      title: 't',
      description: 'd',
      kind: 'read',
      auth: 'guest',
      requires: ['manage_household_rsvp'],
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
      exposure: { ui: true, ai: false, webmcp: false },
      input: z.unknown(),
      output: z.object({ ok: z.boolean() }),
      handler: async () => ok({ data: { ok: true }, sources: [] }),
    }),
  );
});
afterAll(() => setPrincipalResolver(anonymousResolver));

describe('POST /api/capabilities/<name>', () => {
  it('ignores any client-claimed surface: browser POSTs are always ui', async () => {
    const res = await post('site_status', json({ input: {} }, { 'x-capability-surface': 'ai', 'x-request-id': 'req-route-surface' }));
    expect(res.status).toBe(200);
    const rows = await listAuditEvents(await getDb(), { requestId: 'req-route-surface' });
    expect(rows[0]).toMatchObject({ action: 'capability.invoked', metadata: { surface: 'ui' } });
  });

  it('requires JSON from the site origin for signed-in principals (CSRF), not for anonymous reads', async () => {
    const expect403 = async (init: RequestInit) => {
      const res = await post('site_status', init);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    };
    await expect403({ body: 'input=1', headers: { ...asGuest, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' } });
    await expect403(json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }));
    await expect403(json({ input: {} }, { ...asGuest, origin: 'https://evil.example' }));
    await expect403(json({ input: {} }, asGuest));
    expect((await post('site_status', json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
    expect((await post('site_status', json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'none' }))).status).toBe(200);
    expect((await post('site_status', json({ input: {} }, { ...asGuest, origin: publicEnv.siteUrl }))).status).toBe(200);
    expect((await post('site_status', json({ input: {} }, { origin: 'https://evil.example' }))).status).toBe(200);
  });

  it('caps the body while streaming, whatever Content-Length claims', async () => {
    const big = JSON.stringify({ input: { pad: 'x'.repeat(300 * 1024) } });
    const declared = await post('site_status', { body: big, headers: { 'content-type': 'application/json', 'content-length': String(big.length) } });
    expect(declared.status).toBe(422);
    const stream = () =>
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(big));
          c.close();
        },
      });
    const lying = await POST(
      new Request(url('site_status'), { method: 'POST', body: stream(), duplex: 'half', headers: { 'content-type': 'application/json', 'content-length': '10' } } as RequestInit),
      params('site_status'),
    );
    expect(lying.status).toBe(422);
    expect((await lying.json()).error.message).toBe('That request is too large.');
  });

  it('never tells a caller which entitlements they lack', async () => {
    const res = await post('route_test_household', json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain('manage_household_rsvp');
    expect(JSON.parse(text).error.details).toBeUndefined();
  });

  it('rate-limits per IP before reading the body, then per principal, with Retry-After', async () => {
    const limiter = getProvider('rate-limit', { db: await getDb() });
    await limiter.reset('cap:ip:direct');
    for (let i = 0; i < 200; i++) await limiter.consume('cap:ip:direct', 'capabilityIp');
    const big = JSON.stringify({ input: { pad: 'x'.repeat(300 * 1024) } });
    const limited = await post('site_status', { body: big, headers: { 'content-type': 'application/json', 'content-length': String(big.length) } });
    expect(limited.status).toBe(429); // not 422: the limiter ran before the body was considered
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    await limiter.reset('cap:ip:direct');

    await limiter.reset('cap:guest:G1');
    for (let i = 0; i < 60; i++) await limiter.consume('cap:guest:G1', 'capability');
    const guestLimited = await post('site_status', json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'same-origin' }));
    expect(guestLimited.status).toBe(429);
    await limiter.reset('cap:guest:G1');
    expect((await post('site_status', json({ input: {} }, { ...asGuest, 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
  });
});
