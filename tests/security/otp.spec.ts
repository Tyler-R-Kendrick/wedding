import { expect, test } from '@playwright/test';
import { cap, forwardedFor, clearInbox, devHeaders, readOtp, seedFixtures } from './helpers';

test.use({ extraHTTPHeaders: forwardedFor('otp-' + String(Date.now())) });

test.describe('OTP: enumeration, brute force, limits, session fixation, CSRF', () => {
  test('known and unknown emails get byte-identical response shapes; only the known inbox receives mail', async ({ request }) => {
    const f = await seedFixtures(request);
    await clearInbox(request);
    const known = await cap(request, 'request_otp', { purpose: 'sign_in', email: f.emails.amara });
    const unknown = await cap(request, 'request_otp', { purpose: 'sign_in', email: `ghost+${f.suffix}@example.test` });
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(200);
    const a = await known.json();
    const b = await unknown.json();
    expect(Object.keys(a.data).sort()).toEqual(Object.keys(b.data).sort());
    expect(a.data.sent).toBe(true);
    expect(b.data.sent).toBe(true);
    expect(b.data.challenge).not.toContain('@');
    const inbox = await request.get('/api/dev/inbox', { headers: devHeaders() });
    const { messages } = (await inbox.json()) as { messages: { to: string }[] };
    expect(messages.some((m) => m.to.startsWith('ghost+'))).toBe(false);
    expect(messages.some((m) => m.to === f.emails.amara)).toBe(true);
  });

  test('brute force: five wrong codes lock the address, then the right code is refused', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto(`/invite/${f.invitations.okafor!.token}`);
    await page.locator(`input[name="guestId"][value="${f.guests.chidi}"]`).check();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    const code = await readOtp(request, f.emails.chidi!);
    for (let i = 0; i < 5; i++) {
      await page.getByRole('textbox', { name: 'Six-digit code' }).fill(String(900000 + i));
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText(/didn’t work/);
    }
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(code);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: /Too many incorrect codes/ })).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name.endsWith('session_token'))).toBe(false);
  });

  test('per-email send limit answers 429 with Retry-After; verify over the JSON door never mints a session', async ({ request }) => {
    const f = await seedFixtures(request);
    let last = 200;
    let retryAfter: string | undefined;
    for (let i = 0; i < 7; i++) {
      const res = await cap(request, 'request_otp', { purpose: 'sign_in', email: f.emails.chidi }, { origin: 'http://localhost:3106' });
      last = res.status();
      retryAfter = res.headers()['retry-after'];
      if (last === 429) break;
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const verify = await cap(request, 'verify_otp', { challenge: 'x'.repeat(40), code: '123456' });
    expect([422]).toContain(verify.status());
    expect(verify.headers()['set-cookie'] ?? '').not.toContain('session_token');
  });

  test('session fixation: a pre-set cookie is replaced by a new session and the old value is worthless', async ({ page, request, context }) => {
    const f = await seedFixtures(request);
    await context.addCookies([{ name: 'wedding.session_token', value: 'attacker-chosen.value', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(`/invite/${f.invitations.ruiz!.token}`);
    await page.locator(`input[name="guestId"][value="${f.guests.ana}"]`).check();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.ana!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/claim\/welcome/);
    const c = (await context.cookies()).find((k) => k.name === 'wedding.session_token')!;
    expect(c.value).not.toBe('attacker-chosen.value');
    expect((await cap(request, 'get_my_invitation', {}, { cookie: 'wedding.session_token=attacker-chosen.value' })).status()).toBe(401);
    expect((await cap(request, 'get_my_invitation', {}, { cookie: `${c.name}=${c.value}` })).status()).toBe(200);
  });

  test('CSRF: cookie-bearing mutations from a foreign origin are rejected everywhere', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto(`/invite/${f.invitations.okafor!.token}`);
    await page.locator(`input[name="guestId"][value="${f.guests.amara}"]`).check();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.amara!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/claim\/welcome/);
    const c = (await page.context().cookies()).find((k) => k.name.endsWith('session_token'))!;
    const cookie = `${c.name}=${c.value}`;
    expect((await cap(request, 'get_my_invitation', {}, { cookie, origin: 'https://evil.example' })).status()).toBe(401);
    expect((await cap(request, 'update_my_contact', { email: 'evil@example.test' }, { cookie, origin: 'https://evil.example' })).status()).toBe(401);
    expect((await cap(request, 'get_my_invitation', {}, { cookie, origin: 'http://localhost:3106' })).status()).toBe(200);
    const signOut = await request.post('/api/auth/sign-out', { headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, data: {} });
    expect([403, 401]).toContain(signOut.status());
    expect((await cap(request, 'get_my_invitation', {}, { cookie })).status()).toBe(200); // still signed in
  });
});
