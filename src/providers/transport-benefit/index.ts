import type { ServerEnv } from '@/lib/env';
import { ManualCodeTransportBenefit, MemoryCodeSource, MockTransportBenefit } from './mock';
import type { ManualCodeSource, TransportBenefitProvider } from './types';
import { UnconfiguredTransportBenefit } from './unconfigured';
import { UberVouchersTransportBenefit, uberConfigFromEnv } from './uber';

export * from './types';
export { MockTransportBenefit, ManualCodeTransportBenefit, MemoryCodeSource } from './mock';
export { UberVouchersTransportBenefit, uberConfigFromEnv, classifyUberResponse } from './uber';
export { UnconfiguredTransportBenefit } from './unconfigured';

export type TransportBenefitEnv = Pick<
  ServerEnv,
  'FORCE_MOCK_PROVIDERS' | 'TRANSPORT_BENEFIT_MODE' | 'TRANSPORT_MANUAL_CODES' | 'UBER_CLIENT_ID' | 'UBER_CLIENT_SECRET' | 'UBER_ORG_ID' | 'UBER_VOUCHER_PROGRAM_ID' | 'UBER_API_BASE_URL'
> & { isProduction?: boolean };

/**
 * TRANSPORT_BENEFIT_MODE: mock (default) | manual-code | uber.
 * - manual-code: codes come from an explicit source, else the DB-backed source the transport
 *   domain installs, else the dev pool in TRANSPORT_MANUAL_CODES.
 * - uber: the Uber Vouchers adapter when UBER_CLIENT_ID/SECRET + UBER_ORG_ID + UBER_VOUCHER_PROGRAM_ID
 *   are all set; anything missing resolves to the mock (validateConfig names what is missing).
 *
 * Production never gets the mock unless FORCE_MOCK_PROVIDERS says so explicitly: a fake redemption
 * link stored as issued would burn the guest's one claim. Mock mode, or uber mode with missing
 * credentials, resolves to `UnconfiguredTransportBenefit` there — claims fail as
 * `provider_unavailable`, are recorded as failed (retryable), and describeProviders shows
 * mode `unavailable` with what is missing.
 */
export function createTransportBenefitProvider(env: TransportBenefitEnv, deps: { codeSource?: ManualCodeSource; fetch?: typeof fetch } = {}): TransportBenefitProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockTransportBenefit();
  if (env.TRANSPORT_BENEFIT_MODE === 'manual-code') {
    const pool = (env.TRANSPORT_MANUAL_CODES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return new ManualCodeTransportBenefit(deps.codeSource, pool.length ? new MemoryCodeSource(pool) : undefined);
  }
  if (env.TRANSPORT_BENEFIT_MODE === 'uber') {
    const config = uberConfigFromEnv(env);
    if (config.ok) return new UberVouchersTransportBenefit(config.value, { fetch: deps.fetch });
    // Missing credentials never crash the site (ADR-0007 §3): degrade to the mock in dev/test, to an
    // honest unavailable provider in production; health/describeProviders show what is missing.
    if (env.isProduction) return new UnconfiguredTransportBenefit(config.error, 'TRANSPORT_BENEFIT_MODE=uber is missing credentials; ride claims are refused');
    return new MockTransportBenefit();
  }
  if (env.isProduction) return new UnconfiguredTransportBenefit([], 'TRANSPORT_BENEFIT_MODE is mock; production refuses fake vouchers (set manual-code or uber)');
  return new MockTransportBenefit();
}
