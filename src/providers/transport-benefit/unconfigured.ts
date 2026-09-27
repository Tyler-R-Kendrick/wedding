import type { ConfigValidation, ProviderFailure } from '@/contracts/providers';
import { err, type Result } from '@/contracts/result';
import { failure, unconfiguredHealth } from '../base';
import type { TransportBenefitProvider, VoucherClaim } from './types';

/**
 * What production gets instead of the mock. The mock issues a fake `uber.com/redeem/MOCK-…` link;
 * on a real deployment that link would be sealed and stored as an issued claim, and one claim per
 * entitlement means the guest could never claim the real one. This provider fails every claim with
 * `unconfigured` (→ `provider_unavailable`), so the claim is recorded as failed and stays retryable
 * once the planners configure a real mode.
 */
export class UnconfiguredTransportBenefit implements TransportBenefitProvider {
  readonly kind = 'transport-benefit' as const;
  readonly name = 'unconfigured';
  readonly mode = 'unavailable' as const;
  readonly capabilities = { createVoucherClaim: false, getRedemptionLink: false };
  constructor(private readonly missing: string[] = [], private readonly reason = 'no transport-benefit provider is configured for production') {}
  validateConfig(): ConfigValidation {
    return { ok: false, missing: this.missing, warnings: [this.reason] };
  }
  async health() {
    return unconfiguredHealth(this.reason);
  }
  async createVoucherClaim(): Promise<Result<VoucherClaim, ProviderFailure>> {
    return err(failure(this.name, 'unconfigured', 'Ride benefits are not available right now. Please ask us for help.'));
  }
  async getRedemptionLink(): Promise<Result<{ url: string; expiresAt?: string }, ProviderFailure>> {
    return err(failure(this.name, 'unconfigured', 'Ride benefits are not available right now. Please ask us for help.'));
  }
}
