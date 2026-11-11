import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/(admin)/admin/stages/route';
import type { Principal } from '@/contracts/principal';
import { getPrincipalResolver, setPrincipalResolver } from '@/lib/principal';
import { decideStage } from '@/lib/stage-access';

const secret = 'unit-test-secret-not-a-real-one';
const door = (query: string, host = 'example.test') => GET(new Request(`https://${host}/admin/stages${query}`, { headers: { host } }));
const as = (principal: Principal) => setPrincipalResolver({ resolve: async () => principal });

describe('the door to the design stages', () => {
  const before = getPrincipalResolver();
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('BETTER_AUTH_SECRET', secret);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setPrincipalResolver(before);
  });

  it('sends an admin back to the stage with a ticket the stage accepts', async () => {
    as({ kind: 'admin', adminId: 'adm_1' } as Principal);
    const response = await door('?via=host&to=wireframe%2Fguests%2Ftravel');
    expect(response.status).toBe(307);
    const back = new URL(response.headers.get('location')!);
    expect(`${back.origin}${back.pathname}`).toBe('https://wireframe.dev.example.test/__stage-pass');
    const entered = decideStage(
      { host: back.host, protocol: 'https', pathname: back.pathname, ticket: back.searchParams.get('t'), to: back.searchParams.get('to'), pass: undefined, document: true },
      { VERCEL: '1', BETTER_AUTH_SECRET: secret },
    );
    expect(entered).toMatchObject({ kind: 'redirect', location: '/guests/travel', pass: { domain: 'dev.example.test' } });
  });

  it('sends a signed-out visitor to the admin sign-in and back here', async () => {
    as({ kind: 'anonymous' } as Principal);
    const response = await door('?via=host&to=hub');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`/sign-in/admin?next=${encodeURIComponent('/admin/stages?via=host&to=hub')}`);
  });

  it('answers 404 to a guest, to a target that is not a stage, and wherever the stages are open', async () => {
    as({ kind: 'guest', guestId: 'gst_1', householdId: 'hh_1' } as Principal);
    expect((await door('?via=host&to=hub')).status).toBe(404);
    as({ kind: 'admin', adminId: 'adm_1' } as Principal);
    expect((await door('?via=host&to=evil.test%2Fx')).status).toBe(404);
    expect((await door('')).status).toBe(404);
    vi.stubEnv('VERCEL', '');
    expect((await door('?via=host&to=hub')).status).toBe(404);
  });

  it('gives no ticket for a stage by path in production, where stages have their own hosts', async () => {
    as({ kind: 'admin', adminId: 'adm_1' } as Principal);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await door('?via=path&to=wireframe%2Frsvp')).status).toBe(404);
    expect((await door('?via=host&to=wireframe%2Frsvp')).status).toBe(307);
  });
});
