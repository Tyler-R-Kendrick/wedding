import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { authAccounts, invitations, socialAuthReviews } from '@/db/schema';
import { completeSocialSignIn, PENDING_PATH } from '@/domain/identity/social/complete';
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
    await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'Social', lastName: 'Signin', email: null });
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
    if (!r.ok) expect(r.redirectTo).toBe(PENDING_PATH);
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
    if (!r.ok) expect(r.redirectTo).toBe(PENDING_PATH);
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
    if (!r.ok) expect(r.redirectTo).toBe(PENDING_PATH);
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

  it('admin can link an open review to a guest', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: { providerAccountId: 'fb-review', givenName: 'Mystery', familyName: 'Person' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-soc-review',
      audit,
    });
    const review = (await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.providerAccountId, 'fb-review')))[0];
    expect(review?.status).toBe('open');
    const { adminLinkSocialReview } = await import('@/domain/identity/social/complete');
    const linked = await adminLinkSocialReview(db, {
      reviewId: review!.id,
      guestId: f.guests.ana,
      actor: { kind: 'system', component: 'test' },
      requestId: 'req-link',
      audit,
    });
    expect(linked.ok).toBe(true);
  });
});
