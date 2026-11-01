import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { invitations, socialAuthReviews } from '@/db/schema';
import { completeSocialSignIn, PENDING_PATH } from '@/domain/identity/social/complete';
import { getAuditSink } from '@/lib/audit';
import type { CookieSink } from '@/lib/auth/cookies';
import { upsertGuest } from '@/domain/guests/repo';
import type { IdentityFixtures } from '@/domain/identity/fixtures';
import { seed } from './harness';

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

  it('signs in on exact name match when invitation was sent', async () => {
    const db = await getDb();
    const audit = await getAuditSink();
    const r = await completeSocialSignIn(db, sink, {
      provider: 'google',
      profile: { providerAccountId: 'g-ana-int', givenName: 'Social', familyName: 'Signin' },
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
