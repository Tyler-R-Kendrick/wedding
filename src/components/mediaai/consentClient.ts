import { newId } from '@/contracts/ids';
import type { CapabilityFailure } from '../media/capabilityClient';

/**
 * Browser-side caller for POST /api/biometrics/<action>. The shared capability client cannot be
 * used here for two reasons: the consent endpoint is the only door that attaches the keyed client
 * IP hash the ledger needs, and the grant step has to carry the confirmation token issued by the
 * draft step (and read the token back out of the draft's response).
 */
export type ConsentAction = 'draft' | 'grant' | 'revoke' | 'delete';

export type ConsentResponse<T> =
  | { ok: true; data: T; confirmation?: { token: string; expiresAt: string; summary: string } }
  | { ok: false; error: CapabilityFailure };

export async function callConsent<T>(action: ConsentAction, input: unknown, opts: { confirmationToken?: string; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<ConsentResponse<T>> {
  try {
    const res = await fetch(`/api/biometrics/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...(opts.signal ? { signal: opts.signal } : {}),
      body: JSON.stringify({
        input,
        idempotencyKey: opts.idempotencyKey ?? newId(),
        ...(opts.confirmationToken ? { confirmationToken: opts.confirmationToken } : {}),
      }),
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: CapabilityFailure; confirmation?: { token: string; expiresAt: string; summary: string } };
    if (json.ok) return { ok: true, data: json.data as T, ...(json.confirmation ? { confirmation: json.confirmation } : {}) };
    return { ok: false, error: json.error ?? { code: 'internal', message: 'Something went wrong. Please try again.' } };
  } catch {
    return { ok: false, error: { code: 'network', message: 'We could not reach the site. Check your connection and try again.' } };
  }
}

/**
 * The generic capability door, for the two-step admin flows that need a confirmation token. The
 * shared client cannot be used: it neither sends `confirmationToken` nor returns the `confirmation`
 * a draft issues, and an explicit confirmation needs both halves.
 */
export async function callConfirmable<T>(name: string, input: unknown, opts: { confirmationToken?: string; idempotencyKey?: string; mutation?: boolean } = {}): Promise<ConsentResponse<T>> {
  try {
    const res = await fetch(`/api/capabilities/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        input,
        ...(opts.mutation ? { idempotencyKey: opts.idempotencyKey ?? newId() } : {}),
        ...(opts.confirmationToken ? { confirmationToken: opts.confirmationToken } : {}),
      }),
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: CapabilityFailure; confirmation?: { token: string; expiresAt: string; summary: string } };
    if (json.ok) return { ok: true, data: json.data as T, ...(json.confirmation ? { confirmation: json.confirmation } : {}) };
    return { ok: false, error: json.error ?? { code: 'internal', message: 'Something went wrong. Please try again.' } };
  } catch {
    return { ok: false, error: { code: 'network', message: 'We could not reach the site. Check your connection and try again.' } };
  }
}
