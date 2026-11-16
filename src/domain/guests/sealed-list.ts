import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';

/**
 * The guest list, sealed so that only the production deployment can read it.
 *
 * The repository is public and the guest list is not, so the list is never committed in the clear.
 * It is committed sealed: encrypted to a key that exists only inside a production build, derived
 * there from the deployment's own auth secret. Whoever holds that secret can already sign in as
 * anyone, so the sealed file gives away nothing the secret does not. The matching public key is
 * not a secret: the build prints it, and anyone with the sheet can seal a new copy to it
 * (`npm run guests:seal`). Opening needs the secret, which never leaves the deployment.
 *
 * X25519, HKDF-SHA256 and AES-256-GCM, all from node:crypto. A fresh key pair is made for every
 * sealing, so two sealings of the same list share nothing.
 */
const INFO = 'kendrick.wedding guest-list seal v1';
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

export interface SealedGuestList {
  v: 1;
  alg: 'x25519-hkdf-sha256-aes-256-gcm';
  /** Which key it is sealed to (a fingerprint of the public key), so a copy sealed for another key is recognised, not mistaken for a broken one. */
  to: string;
  /** The sealing's own public key. */
  epk: string;
  iv: string;
  tag: string;
  ct: string;
}

const b64 = (b: Buffer) => b.toString('base64url');
const raw = (s: string) => Buffer.from(s, 'base64url');
const publicFromRaw = (key: Buffer) => createPublicKey({ key: Buffer.concat([SPKI_X25519, key]), format: 'der', type: 'spki' });
const rawPublic = (key: KeyObject) => (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
export const sealKeyFingerprint = (publicKey: string) => createHash('sha256').update(raw(publicKey)).digest('hex').slice(0, 16);

/** The deployment's sealing key pair, from its auth secret. The same secret always gives the same pair. */
export function sealKeyFromSecret(secret: string): { privateKey: KeyObject; publicKey: string } {
  if (secret.length < 16) throw new Error('the secret is too short to derive a sealing key from');
  const scalar = Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(INFO, 'utf8'), 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519, scalar]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicKey: b64(rawPublic(createPublicKey(privateKey))) };
}

const contentKey = (shared: Buffer, epk: Buffer, recipient: Buffer) => Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, recipient]), Buffer.from(INFO, 'utf8'), 32));
const header = (to: string, epk: string) => Buffer.from(`${INFO}|${to}|${epk}`, 'utf8');

/** Seals `plaintext` to a deployment's public key. Needs no secret. */
export function sealGuestList(plaintext: string, publicKey: string): SealedGuestList {
  const recipient = raw(publicKey);
  if (recipient.length !== 32) throw new Error('that is not a sealing public key');
  const mine = generateKeyPairSync('x25519');
  const epk = rawPublic(mine.publicKey);
  const key = contentKey(diffieHellman({ privateKey: mine.privateKey, publicKey: publicFromRaw(recipient) }), epk, recipient);
  const iv = randomBytes(12);
  const to = sealKeyFingerprint(publicKey);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header(to, b64(epk)));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return { v: 1, alg: 'x25519-hkdf-sha256-aes-256-gcm', to, epk: b64(epk), iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) };
}

export type OpenResult = { ok: true; plaintext: string } | { ok: false; reason: 'not_sealed' | 'other_key' | 'damaged' };

/** Opens a sealed list with the deployment's key pair. Never throws: what is wrong is said. */
export function openGuestList(sealed: unknown, keys: { privateKey: KeyObject; publicKey: string }): OpenResult {
  const s = sealed as Partial<SealedGuestList> | null;
  if (!s || s.v !== 1 || s.alg !== 'x25519-hkdf-sha256-aes-256-gcm' || typeof s.to !== 'string' || typeof s.epk !== 'string' || typeof s.iv !== 'string' || typeof s.tag !== 'string' || typeof s.ct !== 'string') return { ok: false, reason: 'not_sealed' };
  if (s.to !== sealKeyFingerprint(keys.publicKey)) return { ok: false, reason: 'other_key' };
  try {
    const epk = raw(s.epk);
    const key = contentKey(diffieHellman({ privateKey: keys.privateKey, publicKey: publicFromRaw(epk) }), epk, raw(keys.publicKey));
    const decipher = createDecipheriv('aes-256-gcm', key, raw(s.iv));
    decipher.setAAD(header(s.to, s.epk));
    decipher.setAuthTag(raw(s.tag));
    return { ok: true, plaintext: Buffer.concat([decipher.update(raw(s.ct)), decipher.final()]).toString('utf8') };
  } catch {
    return { ok: false, reason: 'damaged' };
  }
}
