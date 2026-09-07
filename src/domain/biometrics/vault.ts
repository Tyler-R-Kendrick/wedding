import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Vault key seam (ADR-0006 §2): templates are sealed with a key that is separate from every other
 * secret in the system. `BIOMETRIC_VAULT_KEY` is that key (32+ chars, any encoding: it is
 * stretched with SHA-256).
 *
 * The fallback used to be conditional on `NODE_ENV === 'production'` alone, which meant a staging
 * or preview deploy — or a local copy with real data — sealed real templates under a key derived
 * from `CONFIRMATION_SECRET`, the same secret that roots the audit hash key and the consent IP
 * hash. One leak would then have opened all three. The condition is now what the module always
 * claimed: **whenever the feature could actually run**, an explicit key is required. The derived
 * key survives in exactly two places where nothing real can be sealed — the automated tests, and a
 * developer machine with the feature switched off. Turning the flag on locally means setting
 * `BIOMETRIC_VAULT_KEY`, which is the habit worth having.
 */
export interface VaultKey {
  id: string;
  key: Buffer;
  source: 'env' | 'derived';
}

export interface VaultEnv {
  BIOMETRIC_VAULT_KEY?: string;
  CONFIRMATION_SECRET?: string;
  isProduction: boolean;
  /** FLAG_BIOMETRICS_ENABLED. When on, a derived key is refused outside the test environment. */
  biometricsEnabled?: boolean;
  /** NODE_ENV === 'test': fixtures seal fixture templates, so a derived key is fine. */
  isTest?: boolean;
}

export type VaultKeyResult = { ok: true; key: VaultKey } | { ok: false; reason: 'missing_key' };

export function resolveVaultKey(env: VaultEnv): VaultKeyResult {
  if (env.BIOMETRIC_VAULT_KEY) {
    const key = createHash('sha256').update(`biometric-vault:${env.BIOMETRIC_VAULT_KEY}`).digest();
    return { ok: true, key: { id: `env-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`, key, source: 'env' } };
  }
  // No explicit key: acceptable only where no real template can be sealed.
  if (env.isProduction || (env.biometricsEnabled && !env.isTest)) return { ok: false, reason: 'missing_key' };
  const seed = env.CONFIRMATION_SECRET ?? 'dev-only-biometric-vault-seed';
  const key = createHash('sha256').update(`biometric-vault-dev:${seed}`).digest();
  return { ok: true, key: { id: `derived-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`, key, source: 'derived' } };
}

/** AES-256-GCM; output is base64url(iv || tag || ciphertext). */
export function sealTemplate(key: VaultKey, vector: readonly number[]): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, iv);
  const plain = Buffer.from(JSON.stringify(vector), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function openTemplate(key: VaultKey, sealed: string): number[] | null {
  try {
    const buf = Buffer.from(sealed, 'base64url');
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    const parsed: unknown = JSON.parse(plain);
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}
