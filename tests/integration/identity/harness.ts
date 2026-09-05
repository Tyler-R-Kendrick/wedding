import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import type { Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { getDb } from '@/db/client';
import { adminRoles, authSessions } from '@/db/schema';
import { seedIdentityFixtures, type IdentityFixtures } from '@/domain/identity/fixtures';
import { getAuditSink } from '@/lib/audit';
import { installAuthPrincipalResolver, type CookieSink } from '@/lib/auth';
import { getPrincipal } from '@/lib/principal';
import { devInbox } from '@/providers/auth-email/mock';

installAuthPrincipalResolver();

export const SITE = 'http://localhost:3000';
let ipCounter = 0;

export interface Transport {
  cookie?: string;
  ip?: string;
  method?: 'GET' | 'POST';
  origin?: string | null;
}

/** Headers the way a browser would send them: same-origin by default. */
export function requestHeaders(t: Transport = {}): Headers {
  const h = new Headers({ host: 'localhost:3000' });
  if (t.cookie) h.set('cookie', t.cookie);
  if (t.origin !== null) h.set('origin', t.origin ?? SITE);
  return h;
}

export async function principalFor(t: Transport = {}): Promise<Principal> {
  return getPrincipal(new Request(`${SITE}/api/capabilities/x`, { method: t.method ?? 'POST', headers: requestHeaders(t) }));
}

/** Invokes a capability through the real pipeline with the identity transport attached. */
export async function call<T = unknown>(name: string, input: unknown, t: Transport = {}): Promise<Result<CapabilityOutcome<T>, CapabilityError> & { sink: CookieSink; principal: Principal }> {
  const headers = requestHeaders(t);
  const principal = await principalFor(t);
  const sink: CookieSink = { setCookies: [] };
  const ctx = await createCapabilityContext({ principal, requestId: `req-${Math.random().toString(36).slice(2, 10)}`, surface: 'ui' });
  Object.assign(ctx.services, { requestHeaders: headers, clientIp: t.ip ?? `10.0.${++ipCounter % 250}.${(ipCounter * 7) % 250}`, cookieSink: sink });
  const result = (await invokeByName(name, ctx, input)) as Result<CapabilityOutcome<T>, CapabilityError>;
  return Object.assign(result, { sink, principal });
}

export const cookieFrom = (sink: CookieSink): string =>
  sink.setCookies
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.includes('session_token') && !c.endsWith('='))
    .join('; ');

export function latestCode(email: string): string {
  const msg = devInbox.latestFor(email);
  if (!msg) throw new Error(`no OTP in the dev inbox for ${email}`);
  return msg.code;
}

export function expectOk<T>(r: Result<CapabilityOutcome<T>, CapabilityError>): CapabilityOutcome<T> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

export function expectErr<T>(r: Result<CapabilityOutcome<T>, CapabilityError>, code: string): CapabilityError {
  expect(r.ok, `expected error ${code}`).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.error.code).toBe(code);
  return r.error;
}

export async function seed(suffix: string): Promise<IdentityFixtures> {
  const db = await getDb();
  const audit = await getAuditSink();
  return seedIdentityFixtures(db, { audit, requestId: `seed-${suffix}`, suffix });
}

/** Full claim: request code for `guestId` via `token`, read the inbox, verify. Returns the session cookie. */
export async function claim(token: string, guestId: string, inboxEmail: string, t: Transport = {}) {
  const req = expectOk(await call<{ sent: boolean; challenge?: string; deliveredTo?: string; deliveredFor?: string | null }>('request_otp', { purpose: 'claim', token, guestId }, t));
  if (!req.data.sent) throw new Error('claim not sent');
  const ver = await call<{ guestId: string | null; candidates: { guestId: string }[]; isAdmin: boolean }>('verify_otp', { challenge: req.data.challenge, code: latestCode(inboxEmail) }, t);
  const out = expectOk(ver);
  return { cookie: cookieFrom(ver.sink), outcome: out.data, request: req.data };
}

export async function signIn(email: string, t: Transport = {}, purpose: 'sign_in' | 'admin_sign_in' = 'sign_in') {
  const req = expectOk(await call<{ sent: boolean; challenge?: string }>('request_otp', { purpose, email }, t));
  if (!req.data.sent) throw new Error('sign-in not sent');
  const ver = await call<{ guestId: string | null; isAdmin: boolean; candidates: { guestId: string }[] }>('verify_otp', { challenge: req.data.challenge, code: latestCode(email) }, t);
  const out = expectOk(ver);
  return { cookie: cookieFrom(ver.sink), outcome: out.data };
}

export async function grantAdmin(email: string, role: 'owner' | 'planner' | 'moderator' = 'owner') {
  const db = await getDb();
  await db.insert(adminRoles).values({ email, role, grantedBy: { kind: 'system', component: 'test' } }).onConflictDoUpdate({ target: adminRoles.email, set: { role } });
}

/** Ages a session so step-up gates fire. */
export async function ageSession(cookie: string, minutes: number) {
  const db = await getDb();
  const token = cookie.split('=')[1]!.split('.')[0]!;
  await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - minutes * 60_000) }).where(eq(authSessions.token, decodeURIComponent(token)));
}
