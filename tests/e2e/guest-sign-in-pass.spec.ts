import { expect, test } from '@playwright/test';
import { cap, seedFixtures, signInViaUi } from '../security/helpers';

test.describe('guest sign-in pass short link', () => {
  test('GET renders signing-in copy; auto-submit signs the guest in', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const adminCookie = await signInViaUi(page, request, f.emails.admin!, true);
    const issueRes = await cap(request, 'admin_issue_guest_sign_in_pass', { guestId: f.guests.chidi, ttlDays: 30 }, { cookie: adminCookie });
    expect(issueRes.ok()).toBe(true);
    const issue = (await issueRes.json()) as { ok: true; data: { url: string; code: string } };
    expect(issue.ok).toBe(true);
    const { url, code } = issue.data;
    expect(url).not.toContain(code);
    const slug = url.split('/s/')[1]!;
    await page.context().clearCookies();
    await page.goto(`/s/${slug}`);
    await expect(page.getByRole('heading', { name: /Signing you in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/claim\/welcome/, { timeout: 20_000 });
  });

  test('revoked pass shows fallback to email sign-in', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const adminCookie = await signInViaUi(page, request, f.emails.admin!, true);
    const issueRes = await cap(request, 'admin_issue_guest_sign_in_pass', { guestId: f.guests.chidi }, { cookie: adminCookie });
    expect(issueRes.ok()).toBe(true);
    const issue = (await issueRes.json()) as { ok: true; data: { url: string; pass: { id: string } } };
    const revokeRes = await cap(request, 'admin_revoke_guest_sign_in_pass', { passId: issue.data.pass.id }, { cookie: adminCookie });
    expect(revokeRes.ok()).toBe(true);
    const slug = issue.data.url.split('/s/')[1]!;
    await page.goto(`/s/${slug}`);
    await expect(page.getByRole('alert')).toContainText(/no longer active/i);
    await expect(page.getByRole('link', { name: /Sign in with your email/i })).toBeVisible();
  });
});
