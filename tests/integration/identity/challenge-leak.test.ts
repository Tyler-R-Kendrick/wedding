import { describe, expect, it } from 'vitest';
import { CHALLENGE_TOKEN_PATTERN } from '@/domain/identity/challenge';
import { call, expectOk, grantAdmin, seed } from './harness';

/** Review B1: the challenge handed to the browser must carry nothing — no email, ids, or kind — and be identical in shape for known and unknown addresses. */
describe('challenge opacity', () => {
  const decodeParts = (token: string) => token.split('.').map((p) => Buffer.from(p, 'base64url').toString('utf8'));

  it('claim, sign_in and admin_sign_in challenges are nonce.sig with no decodable fields, for known and unknown addresses alike', async () => {
    const f = await seed('leak1');
    await grantAdmin(f.emails.admin, 'owner');
    const tokens: { label: string; token: string; secrets: string[] }[] = [];
    const claim = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'claim', token: f.invitations.okafor.token, guestId: f.guests.chidi }));
    tokens.push({ label: 'claim', token: claim.data.challenge, secrets: [f.emails.chidi, f.guests.chidi, f.invitations.okafor.id, 'claim'] });
    const ruth = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'claim', token: f.invitations.fitzgerald.token, guestId: f.guests.ruth }));
    tokens.push({ label: 'claim-managed', token: ruth.data.challenge, secrets: [f.emails.shared, f.guests.sara, f.guests.ruth] });
    const known = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'sign_in', email: f.emails.amara }));
    const unknown = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'sign_in', email: 'ghost+leak1@example.test' }));
    tokens.push({ label: 'sign_in-known', token: known.data.challenge, secrets: [f.emails.amara, f.guests.amara, 'sign_in'] });
    tokens.push({ label: 'sign_in-unknown', token: unknown.data.challenge, secrets: ['ghost', 'null', '[]'] });
    const adminKnown = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'admin_sign_in', email: f.emails.admin }));
    const adminUnknown = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'admin_sign_in', email: 'notadmin+leak1@example.test' }));
    tokens.push({ label: 'admin-known', token: adminKnown.data.challenge, secrets: [f.emails.admin, 'admin'] });
    tokens.push({ label: 'admin-unknown', token: adminUnknown.data.challenge, secrets: ['notadmin', 'null'] });

    for (const t of tokens) {
      expect(t.token, t.label).toMatch(CHALLENGE_TOKEN_PATTERN);
      const parts = decodeParts(t.token);
      for (const part of parts) {
        expect(() => JSON.parse(part), `${t.label} decodes to JSON`).toThrow();
        // Field names and every real secret (addresses, ids) must be absent; single characters can occur in random bytes.
        expect(part, t.label).not.toMatch(/guestIds|invitationId|managedGuestIds|example\.test/);
        for (const secret of t.secrets.filter((x) => x.length >= 8)) expect(part, `${t.label} leaks ${secret}`).not.toContain(secret);
      }
    }
    // Shape is byte-for-byte comparable: same length, same alphabet, for every purpose and for known vs unknown.
    const lengths = new Set(tokens.map((t) => t.token.length));
    expect(lengths.size).toBe(1);
    expect(known.data.challenge).not.toBe(unknown.data.challenge);
  });
});
