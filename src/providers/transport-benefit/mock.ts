import type { ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { randomToken } from '@/lib/crypto';
import { failure, okConfig, upHealth } from '../base';
import { installedManualCodeSource, type ManualCodeSource, type TransportBenefitProvider, type VoucherClaim, type VoucherClaimRequest } from './types';

const g = globalThis as unknown as { __weddingMockVouchers?: Map<string, VoucherClaim> };
const claims = (): Map<string, VoucherClaim> => (g.__weddingMockVouchers ??= new Map());

/** Issues fake Uber-style redemption links. Idempotent per claimId. */
export class MockTransportBenefit implements TransportBenefitProvider {
  readonly kind = 'transport-benefit' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { createVoucherClaim: true, getRedemptionLink: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async createVoucherClaim(req: VoucherClaimRequest): Promise<Result<VoucherClaim, ProviderFailure>> {
    const existing = claims().get(req.claimId);
    if (existing) return ok(existing);
    const providerRef = `mockref_${randomToken(6)}`;
    const claim: VoucherClaim = {
      claimId: req.claimId,
      providerRef,
      redemptionLink: `https://www.uber.com/redeem/MOCK-${randomToken(9).toUpperCase()}`,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    claims().set(req.claimId, claim);
    return ok(claim);
  }
  async getRedemptionLink(input: { providerRef: string }): Promise<Result<{ url: string; expiresAt?: string }, ProviderFailure>> {
    const claim = [...claims().values()].find((c) => c.providerRef === input.providerRef);
    if (!claim?.redemptionLink) return err(failure(this.name, 'not_found', 'Voucher not found.'));
    return ok({ url: claim.redemptionLink, expiresAt: claim.expiresAt });
  }
  static reset() {
    claims().clear();
  }
}

/**
 * Admin-provided codes (e.g. printed gift codes). No external calls. The code source is
 * resolved per call: an explicit source (tests, dev env pool) wins, otherwise the DB-backed
 * source installed by the transport domain, otherwise the dev pool from TRANSPORT_MANUAL_CODES.
 */
export class ManualCodeTransportBenefit implements TransportBenefitProvider {
  readonly kind = 'transport-benefit' as const;
  readonly name = 'manual-code';
  readonly mode = 'live' as const;
  readonly capabilities = { createVoucherClaim: true, getRedemptionLink: false };
  constructor(private readonly codes?: ManualCodeSource, private readonly fallback?: ManualCodeSource) {}
  private source(): ManualCodeSource | undefined {
    return this.codes ?? installedManualCodeSource() ?? this.fallback;
  }
  validateConfig() {
    return this.source() ? okConfig() : { ok: true, missing: [], warnings: ['no manual code source installed; claims will report no codes available'] };
  }
  async health() {
    return upHealth(this.source() ? 'code source installed' : 'no code source');
  }
  async createVoucherClaim(req: VoucherClaimRequest): Promise<Result<VoucherClaim, ProviderFailure>> {
    const source = this.source();
    const code = source ? await source.takeNext(req.claimId, { program: req.program, entitlementId: req.entitlementId, guestId: req.guestId }) : null;
    if (!code) return err(failure(this.name, 'not_found', 'No ride codes are available right now. Please ask us for help.'));
    return ok({ claimId: req.claimId, providerRef: `manual:${req.claimId}`, code });
  }
  async getRedemptionLink() {
    return err(failure(this.name, 'bad_request', 'Manual codes have no redemption link.'));
  }
}

/** In-memory code source seeded from a list (dev/tests). */
export class MemoryCodeSource implements ManualCodeSource {
  private readonly issued = new Map<string, string>();
  constructor(private readonly pool: string[]) {}
  async takeNext(claimId: string) {
    const existing = this.issued.get(claimId);
    if (existing) return existing;
    const code = this.pool.shift() ?? null;
    if (code) this.issued.set(claimId, code);
    return code;
  }
  async lookup(providerRef: string) {
    return this.issued.get(providerRef.replace(/^manual:/, '')) ?? null;
  }
}
