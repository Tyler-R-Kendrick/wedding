import { describe, expect, it } from 'vitest';
import { openGuestList, sealGuestList, sealKeyFingerprint, sealKeyFromSecret } from '@/domain/guests/sealed-list';

const SECRET = 'a-test-secret-that-is-long-enough';
const LIST = 'Names\tTotal Adults\nBram and Nora Fitzwilliam\t2\nAlma Jarvik and Jody O’Brennan\t2\n';

describe('the sealed guest list', () => {
  it('opens only with the key pair of the deployment it was sealed to', () => {
    const keys = sealKeyFromSecret(SECRET);
    const sealed = sealGuestList(LIST, keys.publicKey);
    expect(openGuestList(sealed, keys)).toEqual({ ok: true, plaintext: LIST });
    // Another deployment (another secret) is told it is not for it, and reads nothing.
    expect(openGuestList(sealed, sealKeyFromSecret('another-secret-of-the-same-length'))).toEqual({ ok: false, reason: 'other_key' });
  });

  it('gives the same key pair for the same secret, and never the secret itself', () => {
    const a = sealKeyFromSecret(SECRET);
    const b = sealKeyFromSecret(SECRET);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.publicKey).not.toContain(SECRET);
    expect(sealKeyFingerprint(a.publicKey)).toMatch(/^[0-9a-f]{16}$/);
    expect(() => sealKeyFromSecret('short')).toThrow();
    // A secret a person might have typed derives no key: the public key would let anyone test guesses at it.
    expect(() => sealKeyFromSecret('x'.repeat(31))).toThrow();
  });

  it('shows nothing of the list, and no two sealings are alike', () => {
    const { publicKey } = sealKeyFromSecret(SECRET);
    const one = sealGuestList(LIST, publicKey);
    const two = sealGuestList(LIST, publicKey);
    const text = JSON.stringify(one);
    for (const word of ['Fitzwilliam', 'Bram', 'Jarvik', 'Names']) expect(text).not.toContain(word);
    expect(Buffer.from(one.ct, 'base64url').toString('utf8')).not.toContain('Fitzwilliam');
    expect(one.ct).not.toBe(two.ct);
    expect(one.epk).not.toBe(two.epk);
  });

  it('a changed or cut-off copy does not open, and nothing throws', () => {
    const keys = sealKeyFromSecret(SECRET);
    const sealed = sealGuestList(LIST, keys.publicKey);
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(openGuestList({ ...sealed, ct: flip(sealed.ct) }, keys)).toEqual({ ok: false, reason: 'damaged' });
    expect(openGuestList({ ...sealed, tag: flip(sealed.tag) }, keys)).toEqual({ ok: false, reason: 'damaged' });
    expect(openGuestList({ ...sealed, iv: flip(sealed.iv) }, keys)).toEqual({ ok: false, reason: 'damaged' });
    expect(openGuestList({ ...sealed, epk: flip(sealed.epk) }, keys)).toEqual({ ok: false, reason: 'damaged' });
    expect(openGuestList({ ...sealed, ct: sealed.ct.slice(0, 10) }, keys)).toEqual({ ok: false, reason: 'damaged' });
    // A tag cut down to a few bytes is refused outright, right or wrong: a short tag can be guessed.
    const shortTag = Buffer.from(sealed.tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(openGuestList({ ...sealed, tag: shortTag }, keys)).toEqual({ ok: false, reason: 'damaged' });
    for (const junk of [null, undefined, {}, [], 'text', 7, { v: 2 }, { ...sealed, alg: 'none' }, { ...sealed, ct: 5 }]) expect(openGuestList(junk, keys)).toEqual({ ok: false, reason: 'not_sealed' });
  });

  it('refuses to seal to something that is not a key', () => {
    expect(() => sealGuestList(LIST, 'not-a-key')).toThrow();
  });
});
