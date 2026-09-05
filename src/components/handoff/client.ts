import { newId } from '@/contracts/ids';
import type { CapabilityErrorShape } from '@/contracts/errors';

export interface CapabilityResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: CapabilityErrorShape;
  confirmation?: { token: string; expiresAt: string; summary: string };
  handoffUrl?: string;
}

/** Browser → POST /api/capabilities/<name>. Same-origin JSON, cookies included; the server decides everything else. */
export async function callCapability<T = unknown>(name: string, body: { input?: unknown; idempotencyKey?: string; confirmationToken?: string } = {}): Promise<CapabilityResponse<T>> {
  try {
    const res = await fetch(`/api/capabilities/${name}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as CapabilityResponse<T>;
  } catch {
    return { ok: false, error: { code: 'internal', message: 'We could not reach the site. Please check your connection and try again.' } };
  }
}

/** One idempotency key per intent (ULID); reused for retries of the same intent. */
export const newIdempotencyKey = (): string => newId();

/** Records a handoff click without blocking navigation; the link itself works without JS. */
export function recordHandoff(capability: string, input: Record<string, unknown>): void {
  // keepalive lets the request finish while the new tab opens; same-origin JSON so the CSRF check passes for signed-in guests.
  void fetch(`/api/capabilities/${capability}`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  }).catch(() => undefined);
}
