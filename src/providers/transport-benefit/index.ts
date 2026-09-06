import type { ServerEnv } from '@/lib/env';
import { ManualCodeTransportBenefit, MemoryCodeSource, MockTransportBenefit } from './mock';
import type { ManualCodeSource, TransportBenefitProvider } from './types';

export * from './types';
export { MockTransportBenefit, ManualCodeTransportBenefit, MemoryCodeSource } from './mock';

/**
 * TRANSPORT_BENEFIT_MODE: mock (default) | manual-code | uber.
 * `uber` needs UBER_CLIENT_ID/SECRET and a real adapter (transport swarm); until then it resolves to mock.
 */
export function createTransportBenefitProvider(
  env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'TRANSPORT_BENEFIT_MODE' | 'TRANSPORT_MANUAL_CODES'>,
  deps: { codeSource?: ManualCodeSource } = {},
): TransportBenefitProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.TRANSPORT_BENEFIT_MODE === 'manual-code') {
    const source = deps.codeSource ?? new MemoryCodeSource((env.TRANSPORT_MANUAL_CODES ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    return new ManualCodeTransportBenefit(source);
  }
  return new MockTransportBenefit();
}
