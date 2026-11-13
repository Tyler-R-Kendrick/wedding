import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { authAccounts, invitations, socialAuthReviews } from '@/db/schema';
import { completeSocialSignIn, GUEST_SIGN_IN_FAIL_PATH, type SocialSignInResult } from '@/domain/identity/social/complete';
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

  it('S-13: ambiguous social name match queues review without session', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const a = await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'Michael', lastName: 'Smith', email: null });
    const b = await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'Michael', lastName: 'Smith', email: null });
    if (!a.ok || !b.ok) throw new Error('guests');
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-s13-${Date.now()}`, givenName: 'Mike', familyName: 'Smith' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-s13',
      audit,
    });
    expect(r.ok).toBe(false);
    expect(sink.setCookies).toHaveLength(0);
    const reviews = await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.reason, 'ambiguous'));
    expect(reviews.length).toBeGreaterThan(0);
  });

  it('U-01 X-06 X-07: unknown social names fail with no session cookie; review queued', async () => {
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

  it('A-07: invitation not sent fails without session', async () => {
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

  it('A-10: admin verified Google email wins before guest name match', async () => {
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

  it('A-02: unverified Google email is ignored for admin match', async () => {
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

  it('A-04: Facebook email treated verified for admin sign-in', async () => {
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

  it('U-02: safe next path preserved on successful name match', async () => {
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

  it('X-07: ambiguous social attempt opens review; admin can link guest', async () => {
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

  it('A-03: Facebook profile without email uses name path only', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: { providerAccountId: `fb-noemail-${Date.now()}`, givenName: 'Nobody', familyName: 'Known' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-soc-fb-noemail',
      audit,
    });
    expect(r.ok).toBe(false);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(false);
  });

  it('A-06 A-16: verified email match allows sign-in when name does not match', async () => {
    const db = await getDb();
    await db.update(invitations).set({ sentAt: new Date() }).where(eq(invitations.householdId, f.households.okafor));
    const secondary = `a06+${Date.now()}@example.test`;
    await replaceGuestContacts(db, f.guests.chidi, [
      { kind: 'email', value: f.emails.chidi, isPrimary: true },
      { kind: 'email', value: secondary },
    ]);
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-a06-${Date.now()}`, givenName: 'Wrong', familyName: 'Person', email: secondary, emailVerified: true },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-a06',
      audit,
    });
    expect(r.ok).toBe(true);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('A-08: guest already bound to another identity is blocked', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const fresh = await upsertGuest(db, { householdId: f.households.ruiz, firstName: `Bound${Date.now()}`, lastName: 'Guest', email: null });
    if (!fresh.ok) throw fresh.error;
    const first = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-bound-a-${Date.now()}`, givenName: fresh.value.firstName, familyName: fresh.value.lastName },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-bound-1',
      audit,
    });
    expect(first.ok).toBe(true);
    sink = { setCookies: [] };
    const second = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-bound-b-${Date.now()}`, givenName: fresh.value.firstName, familyName: fresh.value.lastName },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash2',
      requestId: 'req-bound-2',
      audit,
    });
    expect(second.ok).toBe(false);
    expect(sink.setCookies).toHaveLength(0);
  });

  it('A-12: second provider links via admin after social review', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const providerAccountId = `fb-a12-review-${Date.now()}`;
    const linkTarget = await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'Second', lastName: 'Provider', email: null });
    if (!linkTarget.ok) throw linkTarget.error;
    await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: { providerAccountId, givenName: 'Mystery', familyName: 'Linker' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-a12',
      audit,
    });
    const review = (await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.providerAccountId, providerAccountId)))[0];
    expect(review?.status).toBe('open');
    const { adminLinkSocialReview } = await import('@/domain/identity/social/complete');
    const linked = await adminLinkSocialReview(db, {
      reviewId: review!.id,
      guestId: linkTarget.value.id,
      actor: { kind: 'system', component: 'test' },
      requestId: 'req-a12-link',
      audit,
    });
    expect(linked.ok).toBe(true);
    sink = { setCookies: [] };
    const again = await completeSocialSignIn(db, sink, {
      provider: 'facebook',
      profile: { providerAccountId, givenName: 'Renamed', familyName: 'Later' },
      accessToken: 't2',
      next: '/guests',
      ipHash: 'iphash2',
      requestId: 'req-a12-2',
      audit,
    });
    expect(again.ok).toBe(true);
    const rows = await db.select().from(authAccounts).where(eq(authAccounts.accountId, providerAccountId));
    expect(rows).toHaveLength(1);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('A-09 X-04 X-05: linked provider account signs in again without re-matching', async () => {
    const db = await getDb();
    const providerAccountId = `g-linked-${Date.now()}`;
    const audit = await getAuditSink();
    const fresh = await upsertGuest(db, { householdId: f.households.ruiz, firstName: `Link${Date.now()}`, lastName: 'Provider', email: null });
    if (!fresh.ok) throw fresh.error;
    const ok = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId, givenName: fresh.value.firstName, familyName: fresh.value.lastName },
      accessToken: 't',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-linked-1',
      audit,
    });
    expect(ok.ok).toBe(true);
    const cookieA = [...sink.setCookies];
    sink = { setCookies: [] };
    const again = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId, givenName: 'Renamed', familyName: 'ProviderLater' },
      accessToken: 't2',
      next: '/guests',
      ipHash: 'iphash',
      requestId: 'req-linked-2',
      audit,
    });
    expect(again.ok).toBe(true);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
    expect(cookieA.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('A-11: administrator path wins when admin is also on guest list', async () => {
    const db = await getDb();
    const adminAlso = `admin-also-guest+${Date.now()}@example.test`;
    await grantAdmin(adminAlso, 'owner');
    const onList = await upsertGuest(db, { householdId: f.households.ruiz, firstName: 'AdminAlso', lastName: `Guest${Date.now()}`, email: adminAlso });
    if (!onList.ok) throw onList.error;
    const audit = await getAuditSink();
    const accountId = `g-admin-also-${Date.now()}`;
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: accountId, givenName: 'Nobody', familyName: 'Else', email: adminAlso, emailVerified: true },
      accessToken: 't',
      next: '/admin/guests',
      ipHash: 'iphash',
      requestId: 'req-a11',
      audit,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectTo).toMatch(/^\/admin/);
    expect(sink.setCookies.some((c) => c.includes('session_token'))).toBe(true);
  });

  it('U-08: no_match, not_sent, and blocked failures share save-the-date redirect without session', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const cases: Array<{ label: string; run: () => Promise<SocialSignInResult> }> = [
      {
        label: 'no_match',
        run: () =>
          completeSocialSignIn(db, sink, {
            provider: 'google',
            profile: { providerAccountId: `g-u08-nomatch-${Date.now()}`, givenName: 'Nobody', familyName: 'Here' },
            accessToken: 't',
            next: null,
            ipHash: 'iphash',
            requestId: 'u08-nomatch',
            audit,
          }),
      },
      {
        label: 'not_sent',
        run: async () => {
          await db.update(invitations).set({ sentAt: null }).where(eq(invitations.householdId, f.households.okafor));
          return completeSocialSignIn(db, sink, {
            provider: 'google',
            profile: { providerAccountId: `g-u08-notsent-${Date.now()}`, givenName: 'Chidi', familyName: 'Okafor' },
            accessToken: 't',
            next: null,
            ipHash: 'iphash',
            requestId: 'u08-notsent',
            audit,
          });
        },
      },
      {
        label: 'blocked',
        run: async () => {
          const fresh = await upsertGuest(db, {
            householdId: f.households.ruiz,
            firstName: `U08Bound${Date.now()}`,
            lastName: 'Guest',
            email: null,
          });
          if (!fresh.ok) throw fresh.error;
          const firstSink: CookieSink = { setCookies: [] };
          await completeSocialSignIn(db, firstSink, {
            provider: 'google',
            profile: { providerAccountId: `g-u08-bound-a-${Date.now()}`, givenName: fresh.value.firstName, familyName: fresh.value.lastName },
            accessToken: 't',
            next: '/guests',
            ipHash: 'iphash',
            requestId: 'u08-bound-1',
            audit,
          });
          sink = { setCookies: [] };
          return completeSocialSignIn(db, sink, {
            provider: 'google',
            profile: { providerAccountId: `g-u08-bound-b-${Date.now()}`, givenName: fresh.value.firstName, familyName: fresh.value.lastName },
            accessToken: 't',
            next: '/guests',
            ipHash: 'iphash2',
            requestId: 'u08-bound-2',
            audit,
          });
        },
      },
    ];
  const redirects: string[] = [];
    for (const c of cases) {
      sink = { setCookies: [] };
      const r = await c.run();
      expect(r.ok, c.label).toBe(false);
      if (!r.ok) redirects.push(r.redirectTo);
      expect(sink.setCookies.filter((x) => x.includes('session_token')), c.label).toHaveLength(0);
    }
    expect(new Set(redirects)).toEqual(new Set([GUEST_SIGN_IN_FAIL_PATH]));
    await db.update(invitations).set({ sentAt: new Date() }).where(eq(invitations.householdId, f.households.okafor));
  });

  it('U-06 U-07: minors and unnamed plus-ones never receive social sessions', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const minor = await upsertGuest(db, {
      householdId: f.households.ruiz,
      firstName: 'Minor',
      lastName: `Child${Date.now()}`,
      email: null,
      kind: 'child',
      isMinor: true,
    });
    if (!minor.ok) throw minor.error;
    const plus = await upsertGuest(db, {
      householdId: f.households.ruiz,
      firstName: 'Plus',
      lastName: `One${Date.now()}`,
      email: null,
      kind: 'plus_one',
      isNamed: false,
    });
    if (!plus.ok) throw plus.error;
    for (const guest of [minor.value, plus.value]) {
      sink = { setCookies: [] };
      const r = await completeSocialSignIn(db, sink, {
        provider: 'google',
        profile: {
          providerAccountId: `g-u06-${guest.id}-${Date.now()}`,
          givenName: guest.firstName!,
          familyName: guest.lastName!,
        },
        accessToken: 't',
        next: null,
        ipHash: 'iphash',
        requestId: `u06-${guest.id}`,
        audit,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.redirectTo).toBe(GUEST_SIGN_IN_FAIL_PATH);
      expect(sink.setCookies).toHaveLength(0);
    }
  });

  it('X-08: social completion waits at least 150ms floor', async () => {
    const db = await getDb();
    const started = performance.now();
    await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: `g-floor-${Date.now()}`, givenName: 'Nobody', familyName: 'Here' },
      accessToken: 't',
      next: null,
      ipHash: 'iphash',
      requestId: 'req-floor',
      audit: await getAuditSink(),
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(140);
  });
});
