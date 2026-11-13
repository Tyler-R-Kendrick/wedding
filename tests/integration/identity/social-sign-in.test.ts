import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { authAccounts, invitations, socialAuthReviews } from '@/db/schema';
import { completeSocialSignIn, GUEST_SIGN_IN_FAIL_PATH } from '@/domain/identity/social/complete';
import { replaceGuestContacts } from '@/domain/guests/contacts';
import { getAuditSink } from '@/lib/audit';
import type { CookieSink } from '@/lib/auth/cookies';
import { upsertGuest } from '@/domain/guests/repo';
import type { IdentityFixtures } from '@/domain/identity/fixtures';
import { grantAdmin, seed } from './harness';

describe('social sign-in', () => {
  let sink: CookieSink;
  let f: IdentityFixtures;
  beforeAll(async () => {
    f = await seed('social-int');
    const db = await getDb();
    await db.update(invitations).set({ sentAt: new Date() }).where(eq(invitations.householdId, f.households.ruiz));
    const social = await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'Social', lastName: 'Signin', email: null });
    if (!social.ok) throw social.error;
  });

  beforeEach(() => {
    sink = { setCookies: [] };
  });

  it('redirects to the neutral pending path for unknown names', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: 'g-unknown', givenName: 'Nobody', familyName: 'Here' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-soc-nomatch',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
    const open = await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.status, 'open'));
    expect(open.some((o) => o.reason === 'no_match')).toBe(true);
  });

  it('redirects to pending when invitation not marked sent', async () => {
    const db = await getDb();
    await db.update(invitations).set({ sentAt: null }).where(eq(invitations.householdId, f.households.okafor));
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: 'g-chidi-ns', givenName: 'Chidi', familyName: 'Okafor' },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-soc-notsent',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
    const reviews = await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.providerAccountId, 'g-chidi-ns'));
    expect(reviews.some((x) => x.reason === 'not_sent')).toBe(true);
  });

  it('signs in administrators with verified Google email before name matching', async () => {
    const db = await getDb();
    const adminEmail = `social-admin-google+${Date.now()}@example.test`;
    await grantAdmin(adminEmail, 'owner');
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: {
        providerAccountId: 'g-admin-1',
        givenName: 'Nobody',
        familyName: 'Adminname',
        email: adminEmail.toUpperCase(),
        emailVerified: true,
      },
      accessToken: 't',
      next: '/admin/guests',
      ipHash: 'iphash',
      requestId: 'req-soc-admin-google',
      audit,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectTo).toBe('/admin/guests');
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
    const linked = await db.select().from(authAccounts).where(eq(authAccounts.accountId, 'g-admin-1'));
    expect(linked.length).toBe(1);
  });

  it('does not grant admin session when Google email is unverified', async () => {
    const db = await getDb();
    const adminEmail = `social-admin-unverified+${Date.now()}@example.test`;
    await grantAdmin(adminEmail, 'owner');
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: {
        providerAccountId: 'g-admin-unverified',
        givenName: 'Not',
        familyName: 'OnGuestList',
        email: adminEmail,
        emailVerified: false,
      },
      accessToken: 't',
      next: '/admin',
      ipHash: 'iphash',
      requestId: 'req-soc-admin-unverified',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
  });

  it('signs in administrators with confirmed Facebook email', async () => {
    const db = await getDb();
    const adminEmail = `social-admin-fb+${Date.now()}@example.test`;
    await grantAdmin(adminEmail, 'planner');
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: {
        providerAccountId: 'fb-admin-1',
        givenName: 'X',
        familyName: 'Y',
        email: adminEmail,
        emailVerified: true,
      },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-soc-admin-fb',
      audit,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectTo).toBe('/admin');
  });

  it('signs in on exact name match when invitation was sent', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-ana-int-${Date.now()}`, givenName: 'Social', familyName: 'Signin' },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-soc-ok',
      audit,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectTo).toBe('/guests');
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('A-01 signs in on verified email matching a secondary guest contact', async () => {
    const db = await getDb();
    const db2 = await getDb();
    const secondary = `social-sec+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.ana, [
      { kind: 'email', value: f.emails.ana, isPrimary: true },
      { kind: 'email', value: secondary, label: 'work' },
    ]);
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db2, sink, {
      provider: 'google',
      profile: {
        providerAccountId: `g-ana-email-${Date.now()}`,
        givenName: 'Wrong',
        familyName: 'Name',
        email: secondary,
        emailVerified: true,
      },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash2',
      requestId: 'req-soc-email-match',
      audit,
    });
    expect(r.ok).toBe(true);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('A-05 rejects when verified email and name match different guests', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const otherEmail = `other-social+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.amara, [{ kind: 'email', value: otherEmail, isPrimary: true }]);
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: {
        providerAccountId: `g-conflict-${Date.now()}`,
        givenName: 'Ana',
        familyName: 'Ruiz',
        email: otherEmail,
        emailVerified: true,
      },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-soc-conflict',
      audit,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
    const reviews = await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.reason, 'email_name_conflict'));
    expect(reviews.length).toBeGreaterThan(0);
  });

  it('admin can link an open review to a guest', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const linkTarget = await upsertGuest(db, {
      householdId: f.households.ruiz,
      firstName: 'Review',
      lastName: 'LinkTarget',
      email: null,
    });
    if (!linkTarget.ok) throw linkTarget.error;
    const providerAccountId = `fb-review-${Date.now()}`;
    await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: { providerAccountId, givenName: 'Mystery', familyName: 'Person' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-soc-review',
      audit,
    });
    const review = (await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.providerAccountId, providerAccountId)))[0];
    expect(review?.status).toBe('open');
    const { adminLinkSocialReview } = await import('@/domain/identity/social/complete');
    const linked = await adminLinkSocialReview(db, {
      reviewId: review!.id,
      guestId: linkTarget.value.id,
      actor: { kind: 'system', component: 'test' },
      requestId: 'req-link',
      audit,
    });
    expect(linked.ok).toBe(true);
  });
});
