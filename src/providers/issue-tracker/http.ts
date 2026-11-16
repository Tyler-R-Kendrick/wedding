import type { ProviderErrorClass } from '@/contracts/providers';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** One attempt, bounded. A report is retried by the job queue, never by holding the request open. */
export const TRACKER_TIMEOUT_MS = 8_000;

export function classifyStatus(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export const classifyThrown = (e: unknown): ProviderErrorClass => (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network');
