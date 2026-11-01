import { expect, test } from '@playwright/test';
import { callCapability, key } from './helpers/principal';
import { seedFixtures } from '../security/helpers';

test.describe('guest sign-in pass short link', () => {
  test('GET renders signing-in copy; auto-submit signs an unclaimed guest in through welcome', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const issue = await callCapability(request, 'admin_issue_guest_sign_in_pass', 'admin', { guestId: f.guests.chidi, ttlDays: 30 }, { idempotencyKey: key() });
    expect(issue.status).toBe(200);
    expect(issue.body.ok).toBe(true);
    const { url, code } = issue.body.data as { url: string; code: string };
    expect(url).not.toContain(code);
    const slug = url.split('/s/')[1]!;
    await page.goto(`/s/${slug}`);
    await expect(page.getByRole('heading', { name: /Signing you in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/claim\/welcome/, { timeout: 20_000 });
  });

  test('already-claimed guest lands on /guests', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const first = await callCapability(request, 'admin_issue_guest_sign_in_pass', 'admin', { guestId: f.guests.chidi, ttlDays: 30 }, { idempotencyKey: key() });
    expect(first.body.ok).toBe(true);
    const slug1 = (first.body.data as { url: string }).url.split('/s/')[1]!;
    await page.goto(`/s/${slug1}`);
    await expect(page).toHaveURL(/\/claim\/welcome/, { timeout: 20_000 });

    const second = await callCapability(request, 'admin_issue_guest_sign_in_pass', 'admin', { guestId: f.guests.chidi, ttlDays: 30 }, { idempotencyKey: key() });
    expect(second.body.ok).toBe(true);
    const slug2 = (second.body.data as { url: string }).url.split('/s/')[1]!;
    await page.goto(`/s/${slug2}`);
    await expect(page).toHaveURL(/\/guests(\/|$)/, { timeout: 20_000 });
  });

  test('revoked pass shows fallback to email sign-in', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const issue = await callCapability(request, 'admin_issue_guest_sign_in_pass', 'admin', { guestId: f.guests.chidi }, { idempotencyKey: key() });
    expect(issue.body.ok).toBe(true);
    const data = issue.body.data as { url: string; pass: { id: string } };
    const revoke = await callCapability(request, 'admin_revoke_guest_sign_in_pass', 'admin', { passId: data.pass.id }, { idempotencyKey: key() });
    expect(revoke.status).toBe(200);
    expect(revoke.body.ok).toBe(true);
    const slug = data.url.split('/s/')[1]!;
    await page.goto(`/s/${slug}`);
    await expect(page.getByRole('alert')).toContainText(/no longer active/i);
    await expect(page.getByRole('link', { name: /Sign in with your email/i })).toBeVisible();
  });
});
