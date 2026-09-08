import { beforeAll, describe, expect, it } from 'vitest';
import { getMyInvitation } from '@/capabilities/get_my_invitation';
import { lookupInvitation } from '@/capabilities/lookup_invitation';
import { requestOtp } from '@/capabilities/request_otp';
import type { Db } from '@/db/client';
import { FX, fixturePrincipal } from '@/db/seed/fixtures';
import { issueInvitation, revokeInvitation, rotateInvitation } from '@/domain/invitations/repo';
import { expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * The guest who cannot recover.
 *
 * An independent review walked the paths a stuck guest actually takes — a mangled link, a wrong
 * address, five wrong codes — and found each of them ending on a page whose only offered remedy
 * was the thing that had just failed, or a sentence that was not true.
 */

let db: Db;
const anonymous = { kind: 'anonymous' } as const;
const actor = { kind: 'system', component: 'test' } as const;
const audit = { record: async () => 'audit-test-id' as never };

beforeAll(async () => {
  db = await seedSwarmE();
});

describe('a link that cannot be read', () => {
  it('is a not-found with a way out, not a server fault with none', async () => {
    // 129 characters was the cliff: the capability's `max(128)` made it a VALIDATION error, and the
    // page maps any non-rate-limit failure to "Something went wrong on our side" — rendered with
    // zero links. Every other bad token, including markup, got the recovery panel.
    const long = await run(lookupInvitation, anonymous, { token: 'A'.repeat(400) });
    const r = expectOk(long);
    expect(r.data.status).toBe('unknown');
    expect('recovery' in r.data && r.data.recovery.message).toContain('get in touch with Sara and Tyler');
    // and a short unknown token still behaves the same
    expect(expectOk(await run(lookupInvitation, anonymous, { token: 'nope' })).data.status).toBe('unknown');
  });
});

describe('a link that is no longer active', () => {
  it('says a newer one was sent only when one actually was', async () => {
    const meta = { issuedBy: actor, actor, requestId: 'test', audit, now: new Date() };
    const issued = await issueInvitation(db, { householdId: FX.householdC, ...meta });
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    const rotated = await rotateInvitation(db, { invitationId: issued.ok ? issued.value.invitation.id : '', ...meta });
    expect(rotated.ok).toBe(true);
    const afterRotate = expectOk(await run(lookupInvitation, anonymous, { token: issued.ok ? issued.value.token : '' }));
    expect('recovery' in afterRotate.data && afterRotate.data.recovery.message).toContain('A newer link was sent');

    // A plain revoke sends nothing, and this told the guest to go hunting for an email that will
    // never arrive. `admin_revoke_invitation` and `admin_rotate_invitation` are separate capabilities.
    const solo = await issueInvitation(db, { householdId: FX.householdB, ...meta });
    expect(solo.ok).toBe(true);
    const revoked = await revokeInvitation(db, { invitationId: solo.ok ? solo.value.invitation.id : '', reason: 'test', ...meta });
    expect(revoked.ok).toBe(true);
    const afterRevoke = expectOk(await run(lookupInvitation, anonymous, { token: solo.ok ? solo.value.token : '' }));
    const msg = 'recovery' in afterRevoke.data ? afterRevoke.data.recovery.message : '';
    expect(msg).toContain('no replacement has gone out yet');
    expect(msg).not.toContain('A newer link was sent');
  });
});

describe('the buttons on the welcome page', () => {
  it('say what each one would actually do, so none of them is a guaranteed refusal', async () => {
    // A1 manages household A. A2 (Ben) has no email of his own; A3 is a child.
    const mine = expectOk(await run(getMyInvitation, fixturePrincipal('A1'), {}));
    const byId = new Map(mine.data.members.map((m) => [m.guestId, m]));
    // Ben has no inbox and A1 is the manager: an offer that works, and it does NOT switch the session.
    expect(byId.get(FX.guestA2)?.claimAction).toBe('manage');
    // Seen from a non-manager, the same person is not theirs to take on.
    const asBen = expectOk(await run(getMyInvitation, fixturePrincipal('A2'), {}));
    const ada = asBen.data.members.find((m) => m.guestId === FX.guestA1);
    expect(ada?.claimAction).toBe('own_inbox');
  });
});

describe('the code screen', () => {
  it('reports a verify lockout to the page that offers a new code', async () => {
    // The lock lives at VERIFY time and sending is not gated on it, so "request a new code" always
    // looked like it worked and the correct new code was refused anyway. The instant now rides
    // with the challenge so the page can say so.
    const sent = expectOk(await run(requestOtp, anonymous, { purpose: 'sign_in', email: 'ada.testhouse@example.test' }));
    expect(sent.data.sent).toBe(true);
    expect('lockedUntil' in sent.data).toBe(true);
    expect(sent.data.sent === true && sent.data.lockedUntil).toBeNull();
  });
});
