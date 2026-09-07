import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface VoucherClaimRequest {
  /** Our TransportationClaimId (idempotency anchor at the provider). */
  claimId: string;
  guestId: string;
  entitlementId: string;
  /** Admin-chosen programme key (selects the manual-code pool; maps to a provider programme ref). */
  program?: string;
  /** Provider-side programme/campaign reference when the entitlement carries one. */
  providerProgramRef?: string;
  /** Optional value cap in cents when the provider supports it. */
  valueCents?: number;
}

export interface VoucherClaim {
  claimId: string;
  /** Provider-side reference; never the redemption code. */
  providerRef: string;
  /** Redemption link or code. Stored sealed by the transport domain; never logged. */
  redemptionLink?: string;
  code?: string;
  expiresAt?: string;
}

export interface TransportBenefitProvider extends ProviderDescriptor {
  kind: 'transport-benefit';
  createVoucherClaim(req: VoucherClaimRequest): Promise<Result<VoucherClaim, ProviderFailure>>;
  getRedemptionLink(input: { providerRef: string }): Promise<Result<{ url: string; expiresAt?: string }, ProviderFailure>>;
}

/**
 * Source of admin-provided codes for manual-code mode. The transport domain backs this with
 * the `transportation_manual_codes` table (codes sealed at rest) and installs it through
 * `installManualCodeSource`; providers stay leaves and never import the domain.
 * `takeNext` must be idempotent per claimId (a retry gets the same code, never a second one).
 */
export interface ManualCodeSource {
  takeNext(claimId: string, req?: Pick<VoucherClaimRequest, 'program' | 'entitlementId' | 'guestId'>): Promise<string | null>;
  lookup(providerRef: string): Promise<string | null>;
}

const g = globalThis as unknown as { __weddingManualCodeSource?: ManualCodeSource };

/** Installed by the transport domain at app boot (DB-backed). Explicit `deps.codeSource` in the factory still wins. */
export function installManualCodeSource(source: ManualCodeSource | undefined): void {
  if (source) g.__weddingManualCodeSource = source;
  else delete g.__weddingManualCodeSource;
}

export function installedManualCodeSource(): ManualCodeSource | undefined {
  return g.__weddingManualCodeSource;
}
