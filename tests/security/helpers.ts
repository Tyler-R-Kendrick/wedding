import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared helpers for the security and e2e suites. Fixtures come from the gated dev route
 * (POST /api/dev/identity) and codes from the dev inbox (GET /api/dev/inbox); both accept
 * `Authorization: Bearer $DEV_INBOX_TOKEN` when the environment requires it.
 */
/**
 * The origin the running server believes it is serving, resolved exactly as playwright.config.ts
 * resolves its baseURL. `assertSameOriginJson` compares against it, so a literal here that disagrees
 * with the server turns an authenticated POST into a 401 — which silently inverts a CSRF test's
 * positive control from "our own origin is accepted" into "anything is rejected".
 */
export const SITE_ORIGIN = (process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`).replace(/\/+$/, '');

export const devHeaders = (): Record<string, string> => (process.env.DEV_INBOX_TOKEN ? { authorization: `Bearer ${process.env.DEV_INBOX_TOKEN}` } : {});

export interface Fixtures {
  suffix: string;
  households: Record<string, string>;
  guests: Record<string, string>;
  invitations: Record<string, { id: string; token: string }>;
  emails: Record<string, string>;
}

export async function seedFixtures(request: APIRequestContext): Promise<Fixtures> {
  const res = await request.post('/api/dev/identity', { headers: devHeaders() });
  expect(res.status(), 'dev fixtures route must be available (DEV_INBOX_TOKEN or local development)').toBe(200);
  return (await res.json()) as Fixtures;
}

export async function readOtp(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await request.get('/api/dev/inbox', { headers: devHeaders() });
    expect(res.status()).toBe(200);
    const { messages } = (await res.json()) as { messages: { to: string; code: string; sentAt: string }[] };
    const mine = messages.find((m) => m.to.toLowerCase() === email.toLowerCase());
    if (mine) return mine.code;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no OTP for ${email}`);
}

/** Drives the real claim UI (invite -> pick -> code -> welcome). Returns the session cookie value. */
export async function claimViaUi(page: Page, request: APIRequestContext, token: string, guestId: string, inboxEmail: string): Promise<string> {
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: new RegExp('^' + guestId === '' ? '' : '') }).first().waitFor({ state: 'attached' }).catch(() => {});
  await page.locator(`input[name="guestId"][value="${guestId}"]`).check();
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page).toHaveURL(/\/claim\/verify/);
  const code = await readOtp(request, inboxEmail);
  await page.getByRole('textbox', { name: 'Six-digit code' }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/claim\/welcome/);
  return sessionCookie(page);
}

export async function signInViaUi(page: Page, request: APIRequestContext, email: string, admin = false): Promise<string> {
  await page.goto(admin ? '/sign-in/admin' : '/sign-in');
  await page.getByRole('textbox', { name: admin ? 'Administrator email' : 'Email address' }).fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page).toHaveURL(/\/claim\/verify/);
  const code = await readOtp(request, email);
  await page.getByRole('textbox', { name: 'Six-digit code' }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(admin ? /\/admin/ : /\/claim\/welcome/);
  return sessionCookie(page);
}

export async function sessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((k) => k.name.endsWith('session_token'));
  expect(c, 'session cookie present').toBeTruthy();
  expect(c!.httpOnly).toBe(true);
  expect(c!.sameSite).toBe('Lax');
  return `${c!.name}=${c!.value}`;
}

/** Each spec file behaves like a different network: distinct forwarded IPs keep per-IP buckets apart. */
export const forwardedFor = (seed: string): Record<string, string> => ({ 'x-forwarded-for': `203.0.113.${(Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 200) + 1}` });

export async function cap(request: APIRequestContext, name: string, input: unknown, opts: { cookie?: string; origin?: string; idempotencyKey?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...forwardedFor(`${name}${Math.random()}`) };
  if (opts.cookie) headers.cookie = opts.cookie;
  // Authenticated POSTs must be same-origin JSON (assertSameOriginJson): send the site origin unless a test overrides it.
  const origin = opts.origin ?? (opts.cookie ? SITE_ORIGIN : undefined);
  if (origin) headers.origin = origin;
  return request.post(`/api/capabilities/${name}`, { data: { input, ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}) }, headers });
}
