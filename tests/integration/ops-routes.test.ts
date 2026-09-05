import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { clearJobHandlers, JobQueue, registerJobHandler } from '@/lib/jobs';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, env: { ...actual.env } };
});

const snapshot = { ...env };
const setEnv = (over: Partial<typeof env>) => Object.assign(env, snapshot, over);

const admin: AdminPrincipal = {
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD1' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(['admin_integrations']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

beforeAll(() => setPrincipalResolver({ resolve: async (req) => (req.headers.get('x-test-principal') === 'admin' ? admin : { kind: 'anonymous' }) }));
afterEach(() => setEnv({}));
afterAll(() => setPrincipalResolver(anonymousResolver));

describe('GET /api/health', () => {
  it('is public for liveness but shows the inventory only to admins or the ops bearer', async () => {
    const { GET } = await import('@/app/api/health/route');
    const get = (headers: Record<string, string> = {}) => GET(new Request('http://localhost:3000/api/health', { headers }));
    setEnv({ HEALTH_TOKEN: undefined });
    const pub = await (await get()).json();
    expect(pub).toEqual({ ok: true, db: 'up', time: expect.any(String) });
    expect(pub.providers).toBeUndefined();
    const asAdmin = await (await get({ 'x-test-principal': 'admin' })).json();
    expect(asAdmin.providers).toMatchObject({ storage: 'mock', 'ai-model': 'mock' });
    expect(asAdmin.driver).toBe('pglite');
    setEnv({ HEALTH_TOKEN: 'health-token-0123456789' });
    expect((await (await get({ authorization: 'Bearer health-token-0123456789' })).json()).providers).toBeDefined();
    expect((await (await get({ authorization: 'Bearer health-token-012345678X' })).json()).providers).toBeUndefined();
    expect((await (await get()).json()).providers).toBeUndefined();
  });
});

describe('POST /api/jobs/run', () => {
  it('answers a uniform 401 whether CRON_SECRET is unset or wrong, and runs a batch when right', async () => {
    const { POST } = await import('@/app/api/jobs/run/route');
    const post = (headers: Record<string, string> = {}) => POST(new Request('http://localhost:3000/api/jobs/run', { method: 'POST', headers }));
    setEnv({ CRON_SECRET: undefined });
    const unset = await post({ authorization: 'Bearer anything' });
    expect(unset.status).toBe(401);
    const unsetBody = await unset.text();
    setEnv({ CRON_SECRET: 'c'.repeat(32) });
    const wrong = await post({ authorization: 'Bearer ' + 'x'.repeat(32) });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toBe(unsetBody);
    expect(unsetBody).not.toMatch(/CRON_SECRET|configured/);

    clearJobHandlers();
    const ran: string[] = [];
    registerJobHandler('ops.route_test', async (_p, job) => {
      ran.push(job.id);
    });
    const job = await new JobQueue(await getDb()).enqueue({ type: 'ops.route_test' });
    const okRes = await post({ authorization: 'Bearer ' + 'c'.repeat(32) });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ ok: true, claimed: expect.any(Number), succeeded: expect.any(Number) });
    expect(ran).toContain(job.id);
  });
});
