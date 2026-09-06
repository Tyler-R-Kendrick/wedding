import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { fixtureId, seedId } from '../../../src/db/seed/ids';

/**
 * Test-only principal injection (src/domain/testing/testPrincipal.ts). The e2e server must run with
 * NODE_ENV=test, TEST_AUTH_SECRET=<this>, SEED_TEST_FIXTURES=1 and NEXT_PUBLIC_SITE_URL=<BASE_URL>.
 */
export const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET ?? 'e2e-test-secret-0123456789';

/**
 * Resolved exactly as playwright.config.ts resolves its own `baseURL`, and for the same reason: the
 * origin these tests send must be the origin the server believes it is serving. `assertSameOriginJson`
 * compares the request's Origin against the site URL, so a base that disagrees with the running
 * server turns every authenticated POST into a 401 and quietly changes what the assertions mean —
 * a hardcoded port default did exactly that to the level-06 passkey journey.
 */
const PORT = process.env.PORT ?? '3000';
export const BASE_URL = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');

export const IDS = {
  householdA: fixtureId('HHA'),
  householdB: fixtureId('HHB'),
  householdC: fixtureId('HHC'),
  A1: fixtureId('GSTA1'),
  A2: fixtureId('GSTA2'),
  A3: fixtureId('GSTA3'),
  B1: fixtureId('GSTB1'),
  B2: fixtureId('GSTB2'),
  C1: fixtureId('GSTC1'),
  admin: fixtureId('ADMIN1'),
  mealBeef: fixtureId('MEALBEEF'),
  mealFish: fixtureId('MEALFISH'),
  mealGarden: fixtureId('MEALGARDEN'),
  ceremony: seedId('EVENTCEREMONY'),
  cocktailHour: seedId('EVENTCOCKTAILS'),
  reception: seedId('EVENTRECEPTION'),
} as const;

const guest = (guestId: string, householdId: string, actsFor: string[]) => ({ kind: 'guest' as const, guestId, householdId, actsFor });
export const PRINCIPALS = {
  A1: guest(IDS.A1, IDS.householdA, [IDS.A1, IDS.A2, IDS.A3]),
  A2: guest(IDS.A2, IDS.householdA, [IDS.A2]),
  B1: guest(IDS.B1, IDS.householdB, [IDS.B1, IDS.B2]),
  B2: guest(IDS.B2, IDS.householdB, [IDS.B2]),
  C1: guest(IDS.C1, IDS.householdC, [IDS.C1]),
  admin: { kind: 'admin' as const, adminId: IDS.admin },
} as const;
export type PrincipalName = keyof typeof PRINCIPALS;

export function principalHeaders(name: PrincipalName | null, secret: string = TEST_AUTH_SECRET): Record<string, string> {
  if (!name) return {};
  return { 'x-test-auth': secret, 'x-test-principal': JSON.stringify(PRINCIPALS[name]) };
}

/** Headers for POST /api/capabilities from a signed-in principal: same-origin JSON (CSRF rule). */
export function apiHeaders(name: PrincipalName | null, secret?: string): Record<string, string> {
  return { ...principalHeaders(name, secret), 'content-type': 'application/json', origin: BASE_URL };
}

export interface ApiResult {
  status: number;
  body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> }; confirmation?: { token: string } };
}

export async function callCapability(request: APIRequestContext, name: string, as: PrincipalName | null, input: unknown, extra: { idempotencyKey?: string; confirmationToken?: string; secret?: string } = {}): Promise<ApiResult> {
  const res = await request.post(`/api/capabilities/${name}`, { headers: apiHeaders(as, extra.secret), data: { input, ...(extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}), ...(extra.confirmationToken ? { confirmationToken: extra.confirmationToken } : {}) } });
  return { status: res.status(), body: (await res.json()) as ApiResult['body'] };
}

let counter = 0;
/** ULID-shaped, unique per process: good enough for idempotency keys in tests. */
export function key(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const c = (counter++).toString(36).toUpperCase().padStart(6, '0');
  return `${t}${c}${Math.random().toString(36).slice(2, 12).toUpperCase()}`.replace(/[^0-9A-Z]/g, '0').slice(0, 26).padEnd(26, '0');
}

export async function contextAs(browser: Browser, name: PrincipalName | null, opts: { viewport?: { width: number; height: number } } = {}): Promise<BrowserContext> {
  // `browser.newContext()` does not inherit the config's `use.baseURL`, so pass it: specs navigate
  // with relative paths and must land on the server Playwright actually started.
  return browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: principalHeaders(name), ...(opts.viewport ? { viewport: opts.viewport } : {}) });
}

/** Replaces volatile values so JSON can be snapshot-tested. */
export function stabilize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return '<timestamp>';
      if (k === 'requestId' || k === 'expiresAt' || k === 'token') return '<volatile>';
      return v;
    }),
  );
}
