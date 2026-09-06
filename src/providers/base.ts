import { CapabilityError } from '@/contracts/errors';
import type { ConfigValidation, ProviderErrorClass, ProviderFailure, ProviderHealth, ProviderKind, ProviderMode } from '@/contracts/providers';

/** Small helpers shared by every adapter so descriptors stay uniform. */
export const okConfig = (warnings: string[] = []): ConfigValidation => ({ ok: true, missing: [], warnings });
export const missingConfig = (missing: string[], warnings: string[] = []): ConfigValidation => ({ ok: missing.length === 0, missing, warnings });

export const upHealth = (detail?: string): ProviderHealth => ({ status: 'up', checkedAt: new Date().toISOString(), ...(detail ? { detail } : {}) });
export const unconfiguredHealth = (detail?: string): ProviderHealth => ({ status: 'unconfigured', checkedAt: new Date().toISOString(), ...(detail ? { detail } : {}) });

export function failure(provider: string, cls: ProviderErrorClass, message: string, extra: { retryAfterMs?: number; raw?: unknown } = {}): ProviderFailure {
  return { provider, class: cls, message, ...extra };
}

/** Maps an adapter failure to the guest-safe capability error the UI understands. */
export function toCapabilityError(f: ProviderFailure): CapabilityError {
  const details = { provider: f.provider, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) };
  switch (f.class) {
    case 'rate_limited':
      return new CapabilityError('rate_limited', f.message, details, f.raw);
    case 'unconfigured':
    case 'timeout':
    case 'network':
    case 'server':
      return new CapabilityError('provider_unavailable', f.message, details, f.raw);
    case 'not_found':
      return new CapabilityError('not_found', f.message, details, f.raw);
    default:
      return new CapabilityError('provider_error', f.message, details, f.raw);
  }
}

export interface DescriptorInit {
  kind: ProviderKind;
  name: string;
  mode: ProviderMode;
  capabilities: Record<string, boolean>;
}

/** Stable 32-bit FNV-1a hash for deterministic mock output. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pseudo-random sequence seeded from a string (mulberry32). */
export function seededRandom(seed: string): () => number {
  let a = fnv1a(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nowIso = () => new Date().toISOString();

export function snapshot<T>(provider: string, data: T, ttlSeconds: number) {
  return { provider, retrievedAt: nowIso(), ttlSeconds, data };
}
