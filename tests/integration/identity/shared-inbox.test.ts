import { describe, expect, it } from 'vitest';
import { call, claim, expectErr, expectOk, principalFor, seed, signIn } from './harness';

describe('spouses sharing an inbox', () => {
  it('one claim binds the picked spouse; the other picks themselves afterwards and the session switches', async () => {
    const f = await seed('si1');
    const sara = await claim(f.invitations.fitzgerald.token, f.guests.sara, f.emails.shared);
    expect(sara.outcome.guestId).toBe(f.guests.sara);
    expect(sara.outcome.candidates).toEqual([]);
    // Tyler, on the same device, says "not Sara" -> claim_identity binds him to the same identity.
    const r = expectOk(await call<{ status: string; guestId: string }>('claim_identity', { guestId: f.guests.tyler }, { cookie: sara.cookie }));
    expect(r.data).toMatchObject({ status: 'bound', guestId: f.guests.tyler });
    const p = await principalFor({ cookie: sara.cookie });
    expect(p.kind === 'guest' && p.guestId).toBe(f.guests.tyler);
    expect(p.kind === 'guest' && p.actsFor).toEqual(expect.arrayContaining([f.guests.sara, f.guests.tyler, f.guests.nora, f.guests.ruth]));
    // Later sign-in with the shared email offers both people.
    const again = await signIn(f.emails.shared);
    expect(again.outcome.candidates.map((c) => c.guestId).sort()).toEqual([f.guests.sara, f.guests.tyler].sort());
    // Children cannot be claimed at all.
    expectErr(await call('claim_identity', { guestId: f.guests.nora }, { cookie: again.cookie }), 'forbidden');
  });
});
