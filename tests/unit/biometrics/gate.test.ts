import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityError } from '@/contracts/errors';
import { biometricFeatureReady, gateError } from '@/domain/biometrics/gate';
import { createBiometricProvider, MockBiometric, mockTemplate, setBiometricConsentLookup } from '@/providers/biometric';

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const subject = 'GUESTA';

afterEach(() => setBiometricConsentLookup(undefined));

/** Counts every question the seam asks, so "nothing happened" is provable rather than assumed. */
function harness(opts: { readiness: boolean; consent?: boolean | undefined }) {
  const readiness = vi.fn(async () => opts.readiness);
  const consent = opts.consent === undefined ? undefined : vi.fn(async () => opts.consent!);
  const provider = createBiometricProvider({ readiness, ...(consent ? { consent } : {}) }) as MockBiometric;
  return { provider, readiness, consent };
}

async function refused(fn: () => Promise<unknown>) {
  await expect(fn()).rejects.toBeInstanceOf(CapabilityError);
  await expect(fn()).rejects.toMatchObject({ code: 'feature_disabled' });
}

describe('the biometric seam refuses work unless flag AND readiness AND consent all hold', () => {
  it('does nothing when readiness (flag or the persisted switch) is off', async () => {
    const { provider, consent } = harness({ readiness: false, consent: true });
    await refused(() => provider.assertReady());
    await refused(() => provider.extract({ subjectId: subject, bytes, contentType: 'image/jpeg' }));
    await refused(() => provider.enroll({ subjectId: subject, vector: mockTemplate(bytes) }));
    await refused(() => provider.match({ vector: mockTemplate(bytes), subjectId: subject }));
    expect(provider.size()).toBe(0);
    // Consent is not even consulted: the feature gate comes first.
    expect(consent).not.toHaveBeenCalled();
  });

  it('fails closed when no consent lookup has been installed at all', async () => {
    const { provider } = harness({ readiness: true });
    await refused(() => provider.extract({ subjectId: subject, bytes, contentType: 'image/jpeg' }));
    expect(provider.size()).toBe(0);
  });

  it('refuses a subject with no consent, even with everything else on', async () => {
    const { provider, consent } = harness({ readiness: true, consent: false });
    await refused(() => provider.extract({ subjectId: subject, bytes, contentType: 'image/jpeg' }));
    await refused(() => provider.enroll({ subjectId: subject, vector: mockTemplate(bytes) }));
    expect(consent).toHaveBeenCalledWith(subject);
    expect(provider.size()).toBe(0);
  });

  it('works when readiness and that subject\'s consent both hold', async () => {
    const { provider } = harness({ readiness: true, consent: true });
    const extracted = await provider.extract({ subjectId: subject, bytes, contentType: 'image/jpeg' });
    expect(extracted.ok && extracted.value.vector).toHaveLength(64);
    expect((await provider.enroll({ subjectId: subject, vector: mockTemplate(bytes) })).ok).toBe(true);
    expect(provider.size()).toBe(1);
  });

  it('only ever compares a guest against their own enrolment', async () => {
    const { provider } = harness({ readiness: true, consent: true });
    await provider.enroll({ subjectId: subject, vector: mockTemplate(bytes) });
    await provider.enroll({ subjectId: 'GUESTB', vector: mockTemplate(bytes) });
    const mine = await provider.match({ vector: mockTemplate(bytes), subjectId: subject, threshold: 0.5 });
    expect(mine.ok && mine.value.map((m) => m.subjectId)).toEqual([subject]);
  });

  it('deletes even when the feature is switched off (retention obligations outlive it)', async () => {
    const on = harness({ readiness: true, consent: true });
    await on.provider.enroll({ subjectId: subject, vector: mockTemplate(bytes) });
    const off = createBiometricProvider({ readiness: async () => false });
    expect((await off.delete('nobody')).ok).toBe(true);
    const deleted = await on.provider.delete(subject);
    expect(deleted.ok && deleted.value.deleted).toBe(true);
    expect(on.provider.size()).toBe(0);
  });

  it('uses the globally installed consent lookup when the factory is given none', async () => {
    const lookup = vi.fn(async (id: string) => id === subject);
    setBiometricConsentLookup(lookup);
    const provider = createBiometricProvider({ readiness: async () => true });
    expect((await provider.extract({ subjectId: subject, bytes, contentType: 'image/jpeg' })).ok).toBe(true);
    await refused(() => provider.extract({ subjectId: 'GUESTB', bytes, contentType: 'image/jpeg' }));
    expect(lookup).toHaveBeenCalled();
  });

  it('advertises itself as a mock that must never be enabled without review', () => {
    const provider = createBiometricProvider({ readiness: async () => true });
    expect(provider.mode).toBe('mock');
    const config = provider.validateConfig();
    expect(config.warnings?.join(' ')).toMatch(/counsel review/);
  });

  it('produces a stable template for identical bytes and different ones otherwise', () => {
    expect(mockTemplate(bytes)).toEqual(mockTemplate(new Uint8Array(bytes)));
    expect(mockTemplate(bytes)).not.toEqual(mockTemplate(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])));
  });
});

describe('feature readiness and refusal messages', () => {
  it('names which half of the gate is closed', async () => {
    expect(await biometricFeatureReady({ flags: { BIOMETRICS_ENABLED: false } })).toEqual({ ready: false, reason: 'flag_off' });
    expect(await biometricFeatureReady({ flags: { BIOMETRICS_ENABLED: true } })).toEqual({ ready: false, reason: 'readiness_off' });
    expect(await biometricFeatureReady({ flags: { BIOMETRICS_ENABLED: true }, readiness: async () => false })).toEqual({ ready: false, reason: 'readiness_off' });
    expect(await biometricFeatureReady({ flags: { BIOMETRICS_ENABLED: true }, readiness: async () => true })).toEqual({ ready: true });
  });

  it('maps every refusal to a guest-readable error without leaking internals', () => {
    expect(gateError({ code: 'feature_disabled', reason: 'flag_off' })).toMatchObject({ code: 'feature_disabled' });
    expect(gateError({ code: 'conflict', reason: 'consent_required' }).message).toMatch(/consent/i);
    expect(gateError({ code: 'forbidden', reason: 'not_a_guest' }).message).toMatch(/signed-in guests/);
  });
});
