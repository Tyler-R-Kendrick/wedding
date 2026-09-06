import { expect, test } from '@playwright/test';
import { cap, forwardedFor, claimViaUi, seedFixtures, signInViaUi } from './helpers';

test.use({ extraHTTPHeaders: forwardedFor('invitation-' + String(Date.now())) });

test.describe('invitation tokens', () => {
  test('unknown, malformed, expired and revoked links show recovery, grant nothing, and never set a cookie', async ({ page, request }) => {
    const f = await seedFixtures(request);
    for (const [token, text] of [
      ['0000000000000000000000000000000000000000000', 'couldn’t find that invitation'],
      ['../../etc/passwd', 'couldn’t find that invitation'],
      [f.invitations.expired!.token, 'expired'],
      [f.invitations.revoked!.token, 'no longer active'],
    ] as const) {
      await page.goto(`/invite/${encodeURIComponent(token)}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(text, 'i'));
      await expect(page.locator('body')).toContainText(/Sara and Tyler/);
      expect((await page.context().cookies()).some((c) => c.name.endsWith('session_token'))).toBe(false);
      const look = await cap(request, 'lookup_invitation', { token });
      expect(look.status()).toBe(200);
      expect((await look.json()).data.status).not.toBe('found');
    }
    // A live link reveals names as printed and nothing else.
    const live = await (await cap(request, 'lookup_invitation', { token: f.invitations.fitzgerald!.token })).json();
    expect(live.data.status).toBe('found');
    expect(JSON.stringify(live)).not.toContain('@');
    expect(live.data.members.find((m: { guestId: string }) => m.guestId === f.guests.nora).claimable).toBe(false);
    expect(live.data.members.find((m: { guestId: string }) => m.guestId === f.guests.ruth).claimVia).toBe('manager_email');
  });

  test('replay: a claimed link cannot take over the guest; revoking a link ends discovery while the guest keeps access', async ({ page, request, browser }) => {
    const f = await seedFixtures(request);
    const chidi = await claimViaUi(page, request, f.invitations.okafor!.token, f.guests.chidi!, f.emails.chidi!);
    // Attacker with the forwarded link: code goes to Chidi's inbox; attacker never sees it and cannot verify anything.
    const attacker = await browser.newContext();
    const apage = await attacker.newPage();
    await apage.goto(`/invite/${f.invitations.okafor!.token}`);
    await expect(apage.locator(`input[name="guestId"][value="${f.guests.chidi}"] + span`)).toContainText(/Already claimed/);
    await apage.locator(`input[name="guestId"][value="${f.guests.chidi}"]`).check();
    await apage.getByRole('button', { name: 'Send me a code' }).click();
    await expect(apage).toHaveURL(/\/claim\/verify/);
    await expect(apage.locator('body')).toContainText('c•••@e•••.test');
    await apage.getByRole('textbox', { name: 'Six-digit code' }).fill('123456');
    await apage.getByRole('button', { name: 'Continue' }).click();
    await expect(apage.locator('p[role="alert"]')).toContainText(/didn’t work/);
    expect((await attacker.cookies()).some((c) => c.name.endsWith('session_token'))).toBe(false);
    await attacker.close();

    // Admin revokes the link: discovery stops, Chidi's session keeps working, the token never appears in admin listings.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const admin = await signInViaUi(adminPage, request, f.emails.admin!, true);
    const revoke = await cap(request, 'admin_revoke_invitation', { invitationId: f.invitations.okafor!.id, reason: 'leaked' }, { cookie: admin, idempotencyKey: `revoke-${f.suffix}-${Date.now()}` });
    expect(revoke.status()).toBe(200);
    const listed = await cap(request, 'admin_list_invitations', { householdId: f.households.okafor }, { cookie: admin });
    expect(JSON.stringify(await listed.json())).not.toContain(f.invitations.okafor!.token);
    await adminCtx.close();
    await page.goto(`/invite/${f.invitations.okafor!.token}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/no longer active/);
    expect((await cap(request, 'get_my_invitation', {}, { cookie: chidi })).status()).toBe(200);
  });
});
