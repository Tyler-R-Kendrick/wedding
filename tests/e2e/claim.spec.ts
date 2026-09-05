import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cap, forwardedFor, readOtp, seedFixtures } from '../security/helpers';

test.use({ extraHTTPHeaders: forwardedFor('claim-' + String(Date.now())) });

test.describe('claim journey', () => {
  test('invite -> pick -> code from the dev inbox -> session -> passkey enrollment -> passkey step-up', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto(`/invite/${f.invitations.ruiz!.token}`);
    await expect(page.getByText('We found your invitation')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana Ruiz & Guest');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

    await page.locator(`input[name="guestId"][value="${f.guests.ana}"]`).check();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await expect(page.locator('body')).toContainText('a•••@e•••.test');
    const codeInput = page.getByRole('textbox', { name: 'Six-digit code' });
    expect(await codeInput.evaluate((el) => getComputedStyle(el).fontSize)).not.toBe('16px');
    expect(Number.parseFloat(await codeInput.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
    await codeInput.fill(await readOtp(request, f.emails.ana!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/claim\/welcome/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ana');
    await expect(page.locator('body')).toContainText('you manage the RSVP');

    const cookie = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'))!;
    const mine = await cap(request, 'get_my_invitation', {}, { cookie: `${cookie.name}=${cookie.value}` });
    expect(mine.status()).toBe(200);
    expect((await mine.json()).data.you.displayName).toBe('Ana Ruiz');

    // Passkey enrollment through a CDP virtual authenticator (platform, resident key, user verified).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.getByTestId('passkey-add').click();
    await expect(page.getByTestId('passkey-done')).toBeVisible({ timeout: 15_000 });
    const creds = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(creds.credentials.length).toBe(1);

    // Step-up with the passkey rotates the session and lands back on the target page.
    await page.goto('/step-up?next=%2Fclaim%2Fwelcome');
    await page.getByTestId('stepup-passkey').click();
    await expect(page).toHaveURL(/\/claim\/welcome/, { timeout: 15_000 });
    const rotated = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'))!;
    expect(rotated.value).not.toBe(cookie.value);
    expect((await cap(request, 'get_my_invitation', {}, { cookie: `${cookie.name}=${cookie.value}` })).status()).toBe(401);
    expect((await cap(request, 'register_passkey', { step: 'list' }, { cookie: `${rotated.name}=${rotated.value}`, origin: 'http://localhost:3106' })).status()).toBe(422); // no cookie transport on the JSON door; UI path only

    // Sign out ends the session.
    await page.goto('/sign-out');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await cap(request, 'get_my_invitation', {}, { cookie: `${rotated.name}=${rotated.value}` })).status()).toBe(401);
  });

  test('no-email grandparent is claimed through the manager; shared inbox spouse switches with "not you"', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto(`/invite/${f.invitations.fitzgerald!.token}`);
    await expect(page.locator(`input[name="guestId"][value="${f.guests.nora}"]`)).toBeDisabled();
    await page.locator(`input[name="guestId"][value="${f.guests.ruth}"]`).check();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page.locator('body')).toContainText('Sara Fitzgerald’s email');
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.shared!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Sara');
    await page.getByRole('button', { name: 'I’m Tyler' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Tyler');
  });
});
