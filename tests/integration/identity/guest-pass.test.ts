import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { guestSignInPasses } from '@/db/schema';
import { resetGuestPassVault } from '@/domain/identity/guest-pass-vault';
import { resolveGuestPassPage } from '@/domain/identity/guest-pass';
import { eq } from 'drizzle-orm';
import { call, expectErr, expectOk, seed, signIn } from './harness';

describe('guest sign-in pass', () => {
  it('issues a pass with opaque slug, verifies, revokes, and expires', async () => {
    resetGuestPassVault();
    const f = await seed('gp1');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const issued = expectOk(
      await call<{ code: string; url: string; pass: { id: string; slug: string } }>('admin_issue_guest_sign_in_pass', { guestId: f.guests.chidi, ttlDays: 30 }, { cookie: admin.cookie }),
    );
    expect(issued.data.code).toMatch(/^\d{6}$/);
    expect(issued.data.url).toContain('/s/');
    expect(issued.data.url).not.toContain(issued.data.code);

    const db = await getDb();
    const slug = issued.data.url.split('/s/')[1]!;
    const page = await resolveGuestPassPage(db, slug);
    expect(page?.code).toBe(issued.data.code);

    const signed = expectOk(
      await call<{ guestId: string | null; status: string; needsClaimWelcome?: boolean }>('verify_guest_sign_in_pass', { slug, code: issued.data.code }),
    );
    expect(signed.data.status).toBe('signed_in');
    expect(signed.data.guestId).toBeTruthy();
    expect(signed.data.needsClaimWelcome).toBe(true);

    const again = expectOk(
      await call<{ needsClaimWelcome?: boolean }>('verify_guest_sign_in_pass', { slug, code: issued.data.code }),
    );
    expect(again.data.needsClaimWelcome).toBe(false);

    const revoked = expectOk(await call<{ pass: { lifecycle: string } }>('admin_revoke_guest_sign_in_pass', { passId: issued.data.pass.id }, { cookie: admin.cookie }));
    expect(revoked.data.pass.lifecycle).toBe('revoked');
    expectErr(await call('verify_guest_sign_in_pass', { slug, code: issued.data.code }), 'validation');

    const second = expectOk(await call<{ url: string; pass: { id: string } }>('admin_issue_guest_sign_in_pass', { guestId: f.guests.amara, ttlDays: 1 }, { cookie: admin.cookie }));
    const slug2 = second.data.url.split('/s/')[1]!;
    await db.update(guestSignInPasses).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(guestSignInPasses.id, second.data.pass.id));
    const expiredPage = await resolveGuestPassPage(db, slug2);
    expect(expiredPage?.lifecycle).toBe('expired');
    expect(expiredPage?.code).toBeNull();
  });

  it('rate-limits repeated wrong codes on the same pass', async () => {
    resetGuestPassVault();
    const f = await seed('gp2');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const issued = expectOk(await call<{ code: string; url: string }>('admin_issue_guest_sign_in_pass', { guestId: f.guests.chidi }, { cookie: admin.cookie }));
    const slug = issued.data.url.split('/s/')[1]!;
    for (let i = 0; i < 5; i++) {
      expectErr(await call('verify_guest_sign_in_pass', { slug, code: '000000' }, { ip: '10.9.9.1' }), 'validation');
    }
    expectErr(await call('verify_guest_sign_in_pass', { slug, code: issued.data.code }, { ip: '10.9.9.1' }), 'validation');
  });

  it('admin email contains only the short link', async () => {
    resetGuestPassVault();
    const f = await seed('gp3');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    const issued = expectOk(await call<{ pass: { id: string }; url: string; code: string }>('admin_issue_guest_sign_in_pass', { guestId: f.guests.chidi }, { cookie: admin.cookie }));
    const sent = expectOk(await call<{ sent: boolean }>('admin_email_guest_sign_in_pass', { passId: issued.data.pass.id }, { cookie: admin.cookie }));
    expect(sent.data.sent).toBe(true);
    const { devInbox } = await import('@/providers/auth-email/mock');
    const msg = devInbox.latestMessageFor(f.emails.chidi);
    expect(msg?.text).toContain(issued.data.url);
    expect(msg?.text).not.toContain(issued.data.code);
  });
});
