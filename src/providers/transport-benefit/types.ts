import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface VoucherClaimRequest {
  /** Our TransportationClaimId (idempotency anchor at the provider). */
  claimId: string;
  guestId: string;
  entitlementId: string;
  /** Optional value cap in cents when the provider supports it. */
  valueCents?: number;
}

export interface VoucherClaim {
  claimId: string;
  /** Provider-side reference; never the redemption code. */
  providerRef: string;
  /** Redemption link or code. Stored encrypted by the transport swarm; never logged. */
  redemptionLink?: string;
  code?: string;
  expiresAt?: string;
}

export interface TransportBenefitProvider extends ProviderDescriptor {
  kind: 'transport-benefit';
  createVoucherClaim(req: VoucherClaimRequest): Promise<Result<VoucherClaim, ProviderFailure>>;
  getRedemptionLink(input: { providerRef: string }): Promise<Result<{ url: string; expiresAt?: string }, ProviderFailure>>;
}

/** Source of admin-provided codes for manual-code mode (the transport swarm backs this with a table). */
export interface ManualCodeSource {
  takeNext(claimId: string): Promise<string | null>;
  lookup(providerRef: string): Promise<string | null>;
}
