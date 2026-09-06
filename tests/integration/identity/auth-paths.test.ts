import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { getAuth, HTTP_ALLOWED_AUTH_PATHS } from '@/lib/auth';
import { devInbox } from '@/providers/auth-email/mock';
import { claim, seed, SITE } from './harness';

/** Review S2/S3: every registered Better Auth endpoint answers 404 over HTTP unless explicitly allowlisted. */
describe('Better Auth HTTP surface', () => {
  let ipSeq = 0;
  // Each probe arrives from a distinct forwarded address so Better Auth's own per-IP limiter (429) cannot mask a served endpoint.
  const req = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    new Request(`${SITE}/api/auth${path}`, {
      method: init.method ?? 'POST',
      headers: { 'content-type': 'application/json', origin: SITE, host: 'localhost:3000', 'x-forwarded-for': `198.51.100.${(ipSeq++ % 250) + 1}`, ...(init.cookie ? { cookie: init.cookie } : {}) },
      body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
    });

  it('walks every endpoint: 404 for all but the allowlist, with and without a session', async () => {
    const f = await seed('paths1');
    const chidi = await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    const auth = await getAuth(await getDb());
    const paths = [...new Set(Object.values(auth.api as Record<string, { path?: string }>).map((e) => e.path).filter((p): p is string => typeof p === 'string' && p.startsWith('/')))];
    expect(paths.length).toBeGreaterThan(20);
    const allowed = new Set<string>(HTTP_ALLOWED_AUTH_PATHS);
    const served: string[] = [];
    for (const path of paths) {
      for (const method of ['GET', 'POST'] as const) {
        for (const cookie of [undefined, chidi.cookie]) {
          const res = await auth.handler(req(path, { method, cookie, body: { email: f.emails.chidi, otp: '123456', id: 'x', newEmail: 'x@example.test' } }));
          if (allowed.has(path)) {
            if (res.status !== 404) served.push(`${method} ${path}`);
          } else {
            expect(res.status, `${method} ${path} cookie=${!!cookie}`).toBe(404);
          }
        }
      }
    }
    expect(served.length, 'allowlisted endpoints are actually served').toBeGreaterThan(0);
    // Path-shape probes cannot sidestep the router-level deny.
    for (const p of ['/sign-in/email-otp/', '//sign-in//email-otp', '/sign-in/email-otp%2F', '/forget-password/email-otp', '/passkey/list-user-passkeys']) {
      expect((await auth.handler(req(p, { body: { email: f.emails.chidi, otp: '123456' }, cookie: chidi.cookie }))).status, p).toBe(404);
    }
  });

  it('forget-password/email-otp cannot email a known user outside the capability limits', async () => {
    const f = await seed('paths2');
    await claim(f.invitations.okafor.token, f.guests.chidi, f.emails.chidi);
    devInbox.clear();
    const auth = await getAuth(await getDb());
    const res = await auth.handler(req('/forget-password/email-otp', { body: { email: f.emails.chidi } }));
    expect(res.status).toBe(404);
    expect(devInbox.latestFor(f.emails.chidi)).toBeUndefined();
    // Server-side calls (the capability layer) keep working.
    const sent = await auth.api.sendVerificationOTP({ body: { email: f.emails.chidi, type: 'sign-in' }, headers: new Headers() });
    expect(sent.success).toBe(true);
  });
});
