import { MockBiometric, type ReadinessCheck } from './mock';
import type { BiometricProvider } from './types';

export * from './types';
export { MockBiometric } from './mock';

/** Mock only. `readiness` must combine FLAG BIOMETRICS_ENABLED with the persisted readiness row. */
export function createBiometricProvider(deps: { readiness: ReadinessCheck }): BiometricProvider {
  return new MockBiometric(deps.readiness);
}
