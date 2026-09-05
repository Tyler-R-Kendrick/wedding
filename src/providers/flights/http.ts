import { DEFAULT_CALL_POLICY, type ProviderErrorClass, type ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure } from '../base';

/**
 * Shared HTTP plumbing for the travel adapters (flights + hotels). Every call is bounded by
 * `AbortSignal.timeout`, classified into a `ProviderFailure`, and counted by an optional
 * circuit breaker so a partner outage degrades to the deep-link rung instead of hanging
 * every request. Raw bodies stay in `raw` (server-side); messages are guest-safe.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface JsonCallOptions {
  provider: string;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  /** Retries are only safe for idempotent calls (search create/poll are). Default 0. */
  retries?: number;
  backoffMs?: number;
  fetchImpl?: FetchLike;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
}

export const GUEST_MESSAGES: Record<ProviderErrorClass, string> = {
  timeout: 'The search partner took too long to answer. Please try again.',
  rate_limited: 'The search partner is busy right now. Please wait a moment and try again.',
  auth: 'Live search is not available right now. Use the link to search directly.',
  bad_request: 'Please check the airports, dates and traveller counts.',
  not_found: 'The search partner has no results for that request.',
  server: 'The search partner is having trouble right now. Please try again shortly.',
  malformed_response: 'The search partner sent an answer we could not read. Please try again.',
  network: 'We could not reach the search partner. Please try again.',
  unconfigured: 'Live search is not available; use the link to search directly.',
};

/** Opens after `threshold` consecutive failures and fails fast for `cooldownMs`. */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  constructor(
    private readonly threshold = DEFAULT_CALL_POLICY.circuitBreakAfter,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}
  get isOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (this.now() >= this.openUntil) {
      this.openUntil = 0;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }
  get retryAfterMs(): number {
    return Math.max(0, this.openUntil - this.now());
  }
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) this.openUntil = this.now() + this.cooldownMs;
  }
}

const RETRYABLE: ReadonlySet<ProviderErrorClass> = new Set(['timeout', 'network', 'server']);

export function classifyStatus(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** `Retry-After` in ms (seconds or HTTP date); undefined when absent or unreadable. */
export function retryAfterMs(res: Response, now: number = Date.now()): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** JSON call with timeout, classification, bounded retries, and breaker accounting. `parse` may throw for a malformed body. */
export async function callJson<T>(opts: JsonCallOptions, parse: (body: unknown) => T): Promise<Result<T, ProviderFailure>> {
  const { provider } = opts;
  if (opts.breaker?.isOpen) {
    return err(failure(provider, 'server', GUEST_MESSAGES.server, { retryAfterMs: opts.breaker.retryAfterMs }));
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_POLICY.timeoutMs;
  const retries = opts.retries ?? 0;
  const backoff = opts.backoffMs ?? DEFAULT_CALL_POLICY.backoffMs;
  const sleep = opts.sleep ?? defaultSleep;

  const once = async (): Promise<Result<T, ProviderFailure>> => {
    let res: Response;
    try {
      res = await fetchImpl(opts.url, { ...opts.init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const name = (cause as { name?: string } | undefined)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') return err(failure(provider, 'timeout', GUEST_MESSAGES.timeout, { raw: cause }));
      return err(failure(provider, 'network', GUEST_MESSAGES.network, { raw: cause }));
    }
    if (!res.ok) {
      const cls = classifyStatus(res.status);
      const text = await res.text().catch(() => '');
      const extra = cls === 'rate_limited' ? { retryAfterMs: retryAfterMs(res) ?? 30_000 } : {};
      return err(failure(provider, cls, GUEST_MESSAGES[cls], { raw: { status: res.status, body: text.slice(0, 2_000) }, ...extra }));
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (cause) {
      return err(failure(provider, 'malformed_response', GUEST_MESSAGES.malformed_response, { raw: cause }));
    }
    try {
      return ok(parse(body));
    } catch (cause) {
      return err(failure(provider, 'malformed_response', GUEST_MESSAGES.malformed_response, { raw: cause }));
    }
  };

  let last: ProviderFailure | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
    const result = await once();
    if (result.ok) {
      opts.breaker?.recordSuccess();
      return result;
    }
    last = result.error;
    if (!RETRYABLE.has(last.class)) break;
  }
  opts.breaker?.recordFailure();
  return err(last!);
}

/** Money helper: provider amounts arrive as strings or numbers in whole units unless stated. */
export function toCents(amount: string | number | undefined, unit: 'whole' | 'centi' | 'milli' = 'whole'): number | undefined {
  if (amount === undefined || amount === null) return undefined;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return undefined;
  switch (unit) {
    case 'centi':
      return Math.round(n);
    case 'milli':
      return Math.round(n / 10);
    default:
      return Math.round(n * 100);
  }
}
