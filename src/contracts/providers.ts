/**
 * Common shape for every external-provider adapter. Concrete adapters live in
 * src/providers/<name>/ and are selected by configuration; a mock always exists.
 * Fallback ladder: supported API → provider deep link → admin-configured URL → honest unavailable state.
 */
export const PROVIDER_KINDS = [
  'auth-email', 'storage', 'video', 'media-ai', 'embeddings', 'vector-index', 'biometric', 'ai-model',
  'flights', 'hotels', 'transport-benefit', 'registry', 'cash-fund', 'reservations', 'maps', 'rate-limit', 'jobs',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type ProviderMode = 'mock' | 'sandbox' | 'live' | 'deep-link' | 'unavailable';

export interface ConfigValidation {
  ok: boolean;
  /** Names of env vars that are missing or malformed. Never include values. */
  missing: string[];
  warnings: string[];
}

export interface ProviderHealth {
  status: 'up' | 'degraded' | 'down' | 'unconfigured';
  checkedAt: string;
  latencyMs?: number;
  detail?: string;
}

export interface ProviderDescriptor {
  kind: ProviderKind;
  /** e.g. "uber-vouchers", "skyscanner", "local-fs", "mock" */
  name: string;
  mode: ProviderMode;
  /** Which operations this instance can actually perform right now. */
  capabilities: Record<string, boolean>;
  validateConfig(): ConfigValidation;
  health(): Promise<ProviderHealth>;
}

/** Bounded retry/timeout policy every adapter must honor. */
export interface CallPolicy {
  timeoutMs: number;
  retries: number;
  /** Exponential backoff base in ms. */
  backoffMs: number;
  /** Open the circuit after this many consecutive failures. */
  circuitBreakAfter: number;
}

export const DEFAULT_CALL_POLICY: CallPolicy = { timeoutMs: 8_000, retries: 1, backoffMs: 400, circuitBreakAfter: 5 };

export type ProviderErrorClass = 'timeout' | 'rate_limited' | 'auth' | 'bad_request' | 'not_found' | 'server' | 'malformed_response' | 'network' | 'unconfigured';

export interface ProviderFailure {
  provider: string;
  class: ProviderErrorClass;
  /** Guest-safe message. */
  message: string;
  retryAfterMs?: number;
  /** Server-side only. */
  raw?: unknown;
}

/** Live results are snapshots: always timestamped, never persisted as evergreen knowledge. */
export interface LiveSnapshot<T> {
  provider: string;
  retrievedAt: string;
  /** How long the UI may present this without a refresh. */
  ttlSeconds: number;
  data: T;
}

/** External handoff descriptor used for deep links (Uber, Hyatt, The Knot, OpenTable, …). */
export interface ExternalHandoff {
  provider: string;
  label: string; // "Continue securely with Uber"
  url: string;   // must pass the redirect allowlist
  opensNewTab: boolean;
  /** What we tell the guest before they leave. */
  disclosure: string;
}
