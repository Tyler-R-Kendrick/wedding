import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { CapabilityError } from '@/contracts/errors';
import { err, ok, type Result } from '@/contracts/result';
import { hmacSha256 } from '@/lib/crypto';

/**
 * Secrets at rest for the transport domain: unclaimed ride codes and issued redemption links
 * are sealed with AES-256-GCM before they touch the database. Format:
 *   v1.<keyId>.<iv>.<ciphertext>.<tag>   (base64url parts)
 * The key id lets a rotated key be detected instead of producing garbage. Nothing here logs.
 */
export const VAULT_VERSION = 'v1';
const KEY_INFO = 'wedding-transport-secrets-v1';

export class Vault {
  private readonly key: Buffer;
  readonly keyId: string;

  /** `material` is any string with enough entropy (>= 32 chars enforced by the env schema / derivation). */
  constructor(material: string) {
    if (material.length < 16) throw new Error('vault key material must be at least 16 characters');
    this.key = createHash('sha256').update(`${KEY_INFO}:${material}`).digest();
    this.keyId = createHash('sha256').update(this.key).digest('base64url').slice(0, 12);
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VAULT_VERSION, this.keyId, iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
  }

  unseal(sealed: string): Result<string, CapabilityError> {
    const parts = sealed.split('.');
    if (parts.length !== 5 || parts[0] !== VAULT_VERSION) return err(new CapabilityError('internal', 'That stored code could not be read.', { reason: 'malformed' }));
    const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
    if (keyId !== this.keyId) return err(new CapabilityError('internal', 'That stored code could not be read.', { reason: 'key_mismatch' }));
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]);
      return ok(pt.toString('utf8'));
    } catch {
      return err(new CapabilityError('internal', 'That stored code could not be read.', { reason: 'auth_failed' }));
    }
  }

  /** Keyed fingerprint for de-duplication (never reversible). */
  fingerprint(value: string): string {
    return hmacSha256(this.key.toString('base64url'), value);
  }
}

let singleton: Vault | undefined;

/** App-level vault: TRANSPORT_SECRETS_KEY, else material derived from CONFIRMATION_SECRET (required in production). */
export async function getTransportVault(): Promise<Vault> {
  if (singleton) return singleton;
  const [{ env }, { DEV_CONFIRMATION_SECRET }, { logger }] = await Promise.all([import('@/lib/env'), import('@/policy/confirmation'), import('@/lib/logger')]);
  let material = env.TRANSPORT_SECRETS_KEY;
  if (!material) {
    const base = env.CONFIRMATION_SECRET;
    if (!base && env.isProduction) throw new Error('TRANSPORT_SECRETS_KEY or CONFIRMATION_SECRET is required in production');
    if (!env.isTest) logger.warn('TRANSPORT_SECRETS_KEY is not set; deriving the transport vault key from CONFIRMATION_SECRET');
    material = hmacSha256(base ?? DEV_CONFIRMATION_SECRET, KEY_INFO);
  }
  singleton = new Vault(material);
  return singleton;
}

/** Tests only. */
export function resetTransportVault(): void {
  singleton = undefined;
}
