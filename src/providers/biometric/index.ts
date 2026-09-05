import { MockBiometric, type ReadinessCheck } from './mock';
import type { BiometricProvider } from './types';

export * from './types';
export { MockBiometric, mockTemplate, MOCK_TEMPLATE_DIMS } from './mock';

/**
 * Consent lookup hook. Providers are leaves and cannot read the consent ledger themselves, so the
 * biometrics domain installs a lookup at load time (src/domain/biometrics/gate.ts). Until one is
 * installed every subject-scoped operation fails closed: no consent lookup means no consent.
 */
export type ConsentLookup = (subjectId: string) => Promise<boolean>;

const g = globalThis as unknown as { __weddingBiometricConsentLookup?: ConsentLookup };

export function setBiometricConsentLookup(lookup: ConsentLookup | undefined): void {
  g.__weddingBiometricConsentLookup = lookup;
}

export function getBiometricConsentLookup(): ConsentLookup | undefined {
  return g.__weddingBiometricConsentLookup;
}

/**
 * Mock only. `readiness` combines FLAG BIOMETRICS_ENABLED with the persisted readiness row; the
 * subject's consent is added here so `assertReady(subjectId)` means flag AND readiness AND consent.
 */
export function createBiometricProvider(deps: { readiness: () => Promise<boolean>; consent?: ConsentLookup }): BiometricProvider {
  const gate: ReadinessCheck = async (subjectId) => {
    if (!(await deps.readiness())) return false;
    if (subjectId === undefined) return true;
    const lookup = deps.consent ?? getBiometricConsentLookup();
    if (!lookup) return false;
    return lookup(subjectId);
  };
  return new MockBiometric(gate);
}
