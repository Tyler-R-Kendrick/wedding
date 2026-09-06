import { describe, expect, it } from 'vitest';
import { openTemplate, resolveVaultKey, sealTemplate } from '@/domain/biometrics/vault';
import { combineTemplates } from '@/domain/biometrics/enrollment';

const devEnv = { CONFIRMATION_SECRET: 'x'.repeat(40), isProduction: false };

describe('vault key', () => {
  it('prefers an explicit key and reports where it came from', () => {
    const r = resolveVaultKey({ ...devEnv, BIOMETRIC_VAULT_KEY: 'k'.repeat(40) });
    expect(r.ok && r.key.source).toBe('env');
    expect(r.ok && r.key.key.byteLength).toBe(32);
    expect(r.ok && r.key.id.startsWith('env-')).toBe(true);
  });

  it('derives a development key only where nothing real can be sealed', () => {
    const dev = resolveVaultKey(devEnv);
    expect(dev.ok && dev.key.source).toBe('derived');
    const prod = resolveVaultKey({ ...devEnv, isProduction: true });
    expect(prod.ok).toBe(false);
    if (!prod.ok) expect(prod.reason).toBe('missing_key');
    // In production an explicit key is enough.
    expect(resolveVaultKey({ ...devEnv, isProduction: true, BIOMETRIC_VAULT_KEY: 'k'.repeat(40) }).ok).toBe(true);
  });

  it('refuses a derived key wherever the feature could actually run, not only in production', () => {
    // Staging, a preview deploy, or a local copy with real data: NODE_ENV is not "production",
    // but the flag is on, so a real template could be sealed. A derived key is not acceptable.
    const staging = resolveVaultKey({ ...devEnv, biometricsEnabled: true });
    expect(staging.ok).toBe(false);
    if (!staging.ok) expect(staging.reason).toBe('missing_key');
    // With an explicit key it is fine anywhere.
    expect(resolveVaultKey({ ...devEnv, biometricsEnabled: true, BIOMETRIC_VAULT_KEY: 'k'.repeat(40) }).ok).toBe(true);
    // With the feature off, the derived key is still allowed outside production.
    expect(resolveVaultKey({ ...devEnv, biometricsEnabled: false }).ok).toBe(true);
    // ...and in the test environment, where the only templates are fixtures.
    expect(resolveVaultKey({ ...devEnv, biometricsEnabled: true, isTest: true }).ok).toBe(true);
    // Never in production, whatever else is true.
    expect(resolveVaultKey({ ...devEnv, biometricsEnabled: true, isTest: true, isProduction: true }).ok).toBe(false);
  });

  it('is separate from every other secret: a different confirmation secret gives a different key', () => {
    const a = resolveVaultKey(devEnv);
    const b = resolveVaultKey({ ...devEnv, CONFIRMATION_SECRET: 'y'.repeat(40) });
    expect(a.ok && b.ok && a.key.key.equals(b.key.key)).toBe(false);
    // ...and the vault key is never the confirmation secret itself.
    expect(a.ok && a.key.key.toString('utf8')).not.toContain('x'.repeat(10));
  });
});

describe('sealed templates', () => {
  const key = (() => {
    const r = resolveVaultKey({ ...devEnv, BIOMETRIC_VAULT_KEY: 'k'.repeat(40) });
    if (!r.ok) throw new Error('key');
    return r.key;
  })();
  const other = (() => {
    const r = resolveVaultKey({ ...devEnv, BIOMETRIC_VAULT_KEY: 'z'.repeat(40) });
    if (!r.ok) throw new Error('key');
    return r.key;
  })();
  const vector = [0.1, -0.25, 0.5, 0.75];

  it('round-trips a template through AES-256-GCM', () => {
    const sealed = sealTemplate(key, vector);
    expect(sealed).not.toContain('0.1');
    expect(openTemplate(key, sealed)).toEqual(vector);
  });

  it('is non-deterministic (fresh IV per seal) but always opens', () => {
    expect(sealTemplate(key, vector)).not.toBe(sealTemplate(key, vector));
    expect(openTemplate(key, sealTemplate(key, vector))).toEqual(vector);
  });

  it('returns null rather than throwing for a wrong key, tampering or garbage', () => {
    const sealed = sealTemplate(key, vector);
    expect(openTemplate(other, sealed)).toBeNull();
    const buf = Buffer.from(sealed, 'base64url');
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    expect(openTemplate(key, buf.toString('base64url'))).toBeNull();
    expect(openTemplate(key, 'not-base64url!!')).toBeNull();
    expect(openTemplate(key, '')).toBeNull();
  });
});

describe('reference combination', () => {
  it('averages reference templates into a unit vector', () => {
    const combined = combineTemplates([[1, 0, 0], [0, 1, 0]]);
    const norm = Math.sqrt(combined.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
    expect(combined[0]).toBeCloseTo(combined[1]!, 10);
  });

  it('survives an empty or degenerate input without producing NaN', () => {
    expect(combineTemplates([])).toEqual([]);
    expect(combineTemplates([[0, 0]])).toEqual([0, 0]);
  });
});
