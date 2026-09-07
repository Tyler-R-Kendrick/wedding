import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeEvents, type ConciergeEvent } from '@/ai/events';
import { GET, POST } from '@/app/api/ai/chat/route';
import type { AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { listAuditEvents } from '@/lib/audit';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';

const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'A' as AuthIdentityId,
  guestId: 'G_A' as GuestId,
  householdId: 'H_A' as HouseholdId,
  actsFor: ['G_A' as GuestId],
  entitlements: new Set(['view_event', 'use_concierge']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

const URL_ = 'http://localhost:3000/api/ai/chat';
const post = (init: RequestInit = {}) => POST(new Request(URL_, { method: 'POST', ...init }));
const json = (body: unknown, headers: Record<string, string> = {}) => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

async function readEvents(response: Response): Promise<ConciergeEvent[]> {
  const text = await response.text();
  const { events } = decodeEvents(text.endsWith('\n') ? text : `${text}\n`);
  return events;
}

beforeAll(() => setPrincipalResolver({ resolve: async (req) => (req.headers.get('x-test-principal') === 'guest' ? guest : { kind: 'anonymous' }) }));
afterAll(() => setPrincipalResolver(anonymousResolver));

describe('POST /api/ai/chat', () => {
  it('streams NDJSON events and never a draft the verifier has not accepted', async () => {
    const response = await post(json({ message: 'When is the wedding?' }, { 'x-request-id': 'req-ai-chat-1' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const events = await readEvents(response);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('session');
    expect(types).toContain('status');
    expect(types.at(-1)).toBe('done');
    const text = events.filter((e): e is Extract<ConciergeEvent, { type: 'text' }> => e.type === 'text');
    expect(text.length).toBeGreaterThan(0);
    for (const t of text) expect(t.text).toMatch(/\[S\d+/);
    const sources = events.find((e): e is Extract<ConciergeEvent, { type: 'sources' }> => e.type === 'sources');
    expect(sources?.sources.every((s) => !s.url || s.url.startsWith('/') || s.url.startsWith('https://'))).toBe(true);
  });

  it('sets the surface server-side: nothing in the request can claim to be the AI', async () => {
    await post(json({ message: 'When is the wedding?' }, { 'x-request-id': 'req-ai-surface', 'x-capability-surface': 'ui' })).then(readEvents);
    const rows = await listAuditEvents(await getDb(), { requestId: 'req-ai-surface' });
    const invoked = rows.filter((r) => r.action === 'capability.invoked');
    // Also proves the route registers the capability list: an unregistered registry would run none.
    expect(invoked.length).toBeGreaterThan(0);
    expect(invoked.every((r) => (r.metadata as { surface?: string }).surface === 'ai')).toBe(true);
  });

  it('requires same-origin JSON from a signed-in guest (CSRF)', async () => {
    const cross = await post(json({ message: 'When is the wedding?' }, { 'x-test-principal': 'guest', origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    const same = await post(json({ message: 'When is the wedding?' }, { 'x-test-principal': 'guest', 'sec-fetch-site': 'same-origin' }));
    expect(same.status).toBe(200);
  });

  it('requires a JSON content type even from anonymous callers', async () => {
    const res = await post({ body: 'message=hi', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.status).toBe(403);
  });

  it('validates the question before any model or tool runs', async () => {
    for (const body of [{}, { message: 'x' }, { message: 'a'.repeat(2001) }, { message: 'ok question', sessionId: 'not-a-ulid' }]) {
      const res = await post(json(body));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe('validation');
    }
  });

  it('caps the body before reading it all', async () => {
    const res = await post(json({ message: `When is the wedding? ${'x'.repeat(20_000)}` }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details?: { maxBytes?: number } } };
    expect(body.error.code).toBe('validation');
    expect(body.error.details?.maxBytes).toBe(16 * 1024);
  });

  it('answers GET with 405 and an Allow header', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
