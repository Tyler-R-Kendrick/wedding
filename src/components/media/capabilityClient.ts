import { newId } from '@/contracts/ids';

/**
 * Browser-side caller for the capability door. Same-origin JSON (the CSRF check requires it);
 * mutations get a fresh ULID idempotency key unless the caller passes one (retries reuse it).
 */
export interface CapabilityFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type CapabilityResponse<T> = { ok: true; data: T } | { ok: false; error: CapabilityFailure };

export async function callCapability<T>(name: string, input: unknown, opts: { idempotencyKey?: string; mutation?: boolean; path?: string; signal?: AbortSignal } = {}): Promise<CapabilityResponse<T>> {
  const body: Record<string, unknown> = { input };
  if (opts.mutation) body.idempotencyKey = opts.idempotencyKey ?? newId();
  try {
    const res = await fetch(opts.path ?? `/api/capabilities/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal: opts.signal,
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: CapabilityFailure };
    if (json.ok) return { ok: true, data: json.data as T };
    return { ok: false, error: json.error ?? { code: 'internal', message: 'Something went wrong. Please try again.' } };
  } catch {
    return { ok: false, error: { code: 'network', message: 'We could not reach the site. Check your connection and try again.' } };
  }
}
