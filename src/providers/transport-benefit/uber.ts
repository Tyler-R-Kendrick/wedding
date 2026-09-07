import { DEFAULT_CALL_POLICY, type ProviderErrorClass, type ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { isAllowedRedirect } from '@/lib/redirects';
import { failure, missingConfig, okConfig, unconfiguredHealth, upHealth } from '../base';
import type { TransportBenefitProvider, VoucherClaim, VoucherClaimRequest } from './types';

/**
 * Uber for Business Vouchers adapter (implementation-ready; defaults to the mock until the
 * couple's programme exists — backlog P-05). Server-side only: OAuth2 client-credentials,
 * create-or-fetch a voucher for our claim id, and return the redemption link the guest opens
 * in the Uber app ("Open in Uber"); we never redeem on the guest's behalf and never see a
 * rider's account. Endpoint paths are configurable-by-constant so the partner contract can
 * pin them without touching call logic. Redemption links are secrets: never logged.
 */
export interface UberVouchersConfig {
  clientId: string;
  clientSecret: string;
  organizationId: string;
  programId: string;
  /** Defaults to https://api.uber.com; overridable for the partner sandbox. */
  apiBaseUrl?: string;
  /** Defaults to https://auth.uber.com/oauth/v2/token. */
  tokenUrl?: string;
  scope?: string;
}

export const UBER_API_BASE_URL = 'https://api.uber.com';
export const UBER_TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
export const UBER_VOUCHER_SCOPE = 'business.vouchers';
/** Voucher endpoints under /v1/organizations/{org}/voucher-programs/{program}/vouchers (verify against the partner contract). */
export const UBER_PATHS = {
  vouchers: (org: string, program: string) => `/v1/organizations/${encodeURIComponent(org)}/voucher-programs/${encodeURIComponent(program)}/vouchers`,
  voucher: (org: string, program: string, id: string) => `/v1/organizations/${encodeURIComponent(org)}/voucher-programs/${encodeURIComponent(program)}/vouchers/${encodeURIComponent(id)}`,
} as const;

const NAME = 'uber-vouchers';
const MAX_RESPONSE_BYTES = 256 * 1024;

export function uberConfigFromEnv(env: {
  UBER_CLIENT_ID?: string;
  UBER_CLIENT_SECRET?: string;
  UBER_ORG_ID?: string;
  UBER_VOUCHER_PROGRAM_ID?: string;
  UBER_API_BASE_URL?: string;
}): Result<UberVouchersConfig, string[]> {
  const missing: string[] = [];
  if (!env.UBER_CLIENT_ID) missing.push('UBER_CLIENT_ID');
  if (!env.UBER_CLIENT_SECRET) missing.push('UBER_CLIENT_SECRET');
  if (!env.UBER_ORG_ID) missing.push('UBER_ORG_ID');
  if (!env.UBER_VOUCHER_PROGRAM_ID) missing.push('UBER_VOUCHER_PROGRAM_ID');
  if (missing.length) return err(missing);
  return ok({
    clientId: env.UBER_CLIENT_ID!,
    clientSecret: env.UBER_CLIENT_SECRET!,
    organizationId: env.UBER_ORG_ID!,
    programId: env.UBER_VOUCHER_PROGRAM_ID!,
    apiBaseUrl: env.UBER_API_BASE_URL,
  });
}

/** Maps an HTTP status to a provider error class (guest-safe message chosen by the caller). */
export function classifyUberResponse(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'malformed_response';
}

interface UberVoucherResource {
  id?: string;
  voucher_id?: string;
  redemption_link?: string;
  link?: string;
  url?: string;
  expires_at?: string | number;
  expiration_time?: string | number;
}

const asIso = (v: string | number | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export class UberVouchersTransportBenefit implements TransportBenefitProvider {
  readonly kind = 'transport-benefit' as const;
  readonly name = NAME;
  readonly mode = 'live' as const;
  readonly capabilities = { createVoucherClaim: true, getRedemptionLink: true };
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: UberVouchersConfig, deps: { fetch?: typeof fetch; timeoutMs?: number; now?: () => number } = {}) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_CALL_POLICY.timeoutMs;
    this.now = deps.now ?? (() => Date.now());
  }
  private readonly now: () => number;

  validateConfig() {
    const missing: string[] = [];
    if (!this.config.clientId) missing.push('UBER_CLIENT_ID');
    if (!this.config.clientSecret) missing.push('UBER_CLIENT_SECRET');
    if (!this.config.organizationId) missing.push('UBER_ORG_ID');
    if (!this.config.programId) missing.push('UBER_VOUCHER_PROGRAM_ID');
    return missing.length ? missingConfig(missing) : okConfig();
  }

  async health() {
    if (!this.validateConfig().ok) return unconfiguredHealth('credentials missing');
    const started = performance.now();
    const token = await this.accessToken();
    const latencyMs = Math.round(performance.now() - started);
    if (!token.ok) return { status: 'down' as const, checkedAt: new Date().toISOString(), latencyMs, detail: token.error.class };
    return { ...upHealth('token ok'), latencyMs };
  }

  async createVoucherClaim(req: VoucherClaimRequest): Promise<Result<VoucherClaim, ProviderFailure>> {
    // Idempotent at the provider: our claim id is the external reference; an existing voucher is fetched, never duplicated.
    const existing = await this.request<UberVoucherResource>('GET', UBER_PATHS.voucher(this.config.organizationId, this.config.programId, `ext:${req.claimId}`));
    if (existing.ok) return this.toClaim(req.claimId, existing.value);
    if (existing.error.class !== 'not_found') return err(existing.error);
    const body: Record<string, unknown> = { external_reference: req.claimId, quantity: 1 };
    if (req.valueCents !== undefined) body.value = { amount: req.valueCents, currency_code: 'USD' };
    const created = await this.request<UberVoucherResource>('POST', UBER_PATHS.vouchers(this.config.organizationId, this.config.programId), body);
    if (!created.ok) return err(created.error);
    return this.toClaim(req.claimId, created.value);
  }

  async getRedemptionLink(input: { providerRef: string }): Promise<Result<{ url: string; expiresAt?: string }, ProviderFailure>> {
    const got = await this.request<UberVoucherResource>('GET', UBER_PATHS.voucher(this.config.organizationId, this.config.programId, input.providerRef));
    if (!got.ok) return err(got.error);
    const url = got.value.redemption_link ?? got.value.link ?? got.value.url;
    if (!url || !isAllowedRedirect(url)) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.'));
    return ok({ url, expiresAt: asIso(got.value.expires_at ?? got.value.expiration_time) });
  }

  private toClaim(claimId: string, v: UberVoucherResource): Result<VoucherClaim, ProviderFailure> {
    const providerRef = v.id ?? v.voucher_id;
    const link = v.redemption_link ?? v.link ?? v.url;
    if (!providerRef || !link) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.'));
    // A redemption link that is not on uber.com is never handed to a guest, whatever the API says.
    if (!isAllowedRedirect(link)) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.'));
    return ok({ claimId, providerRef, redemptionLink: link, expiresAt: asIso(v.expires_at ?? v.expiration_time) });
  }

  private async accessToken(): Promise<Result<string, ProviderFailure>> {
    if (this.token && this.token.expiresAt > this.now() + 30_000) return ok(this.token.value);
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId, client_secret: this.config.clientSecret, scope: this.config.scope ?? UBER_VOUCHER_SCOPE });
    const res = await this.send(this.config.tokenUrl ?? UBER_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString() });
    if (!res.ok) return err(res.error);
    const json = res.value.json as { access_token?: string; expires_in?: number } | undefined;
    if (res.value.status !== 200 || !json?.access_token) {
      return err(failure(NAME, res.value.status === 200 ? 'malformed_response' : classifyUberResponse(res.value.status), 'The ride provider could not authorise this request.', { raw: { status: res.value.status } }));
    }
    const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 1800;
    this.token = { value: json.access_token, expiresAt: this.now() + ttl * 1000 };
    return ok(json.access_token);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Result<T, ProviderFailure>> {
    const token = await this.accessToken();
    if (!token.ok) return err(token.error);
    const base = (this.config.apiBaseUrl ?? UBER_API_BASE_URL).replace(/\/+$/, '');
    const res = await this.send(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token.value}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return err(res.error);
    const { status, json, retryAfterMs } = res.value;
    if (status === 401) this.token = undefined; // force a fresh token next time
    if (status < 200 || status >= 300) {
      const cls = classifyUberResponse(status);
      const message = cls === 'rate_limited' ? 'The ride provider is busy. Please try again in a moment.' : cls === 'not_found' ? 'Voucher not found.' : 'The ride provider could not complete this request.';
      return err(failure(NAME, cls, message, { retryAfterMs, raw: { status } }));
    }
    if (!json || typeof json !== 'object') return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.', { raw: { status } }));
    return ok(json as T);
  }

  /** One bounded HTTP call: timeout via AbortSignal, capped response, no retries on writes. Never logs bodies. */
  private async send(url: string, init: RequestInit): Promise<Result<{ status: number; json: unknown; retryAfterMs?: number }, ProviderFailure>> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') return err(failure(NAME, 'timeout', 'The ride provider took too long to answer.', { raw: name }));
      return err(failure(NAME, 'network', 'We could not reach the ride provider.', { raw: name || 'network' }));
    }
    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : undefined;
    let text: string;
    try {
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_RESPONSE_BYTES) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.'));
      text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.'));
    } catch {
      return err(failure(NAME, 'network', 'We could not read the ride provider response.'));
    }
    let json: unknown = undefined;
    if (text.trim().length) {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.status >= 200 && response.status < 300) return err(failure(NAME, 'malformed_response', 'The ride provider returned an unexpected response.', { raw: { status: response.status } }));
      }
    }
    return ok({ status: response.status, json, retryAfterMs });
  }
}
