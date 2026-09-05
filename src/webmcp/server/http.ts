import 'server-only';
import type { CapabilityOutcome } from '@/contracts/capability';
import { CapabilityError, HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { err, ok, type Result } from '@/contracts/result';
import { jsonResponse, SAME_ORIGIN_MESSAGE } from '@/lib/request';

/** Guest-safe error envelope; entitlement names (`details.missing`) never leave the server. */
export function errorResponse(error: CapabilityError, requestId: string): Response {
  const headers: Record<string, string> = {};
  const retry = error.details?.retryAfterMs;
  if (typeof retry === 'number') headers['Retry-After'] = String(Math.ceil(retry / 1000));
  const { missing: _missing, ...details } = error.details ?? {};
  const body = { code: error.code, message: error.message, ...(Object.keys(details).length ? { details } : {}) };
  return jsonResponse({ ok: false, error: body }, { status: HTTP_STATUS_FOR_CODE[error.code], requestId, headers });
}

export const rateLimited = (retryAfterMs: number | undefined, requestId: string): Response =>
  errorResponse(new CapabilityError('rate_limited', 'Too many requests. Please wait a moment.', { retryAfterMs }), requestId);

export const featureDisabled = (requestId: string): Response =>
  errorResponse(new CapabilityError('feature_disabled', 'This feature is not available right now.'), requestId);

/**
 * Success envelope for an agent. Same shape as the UI route except that a draft's confirmation
 * TOKEN is dropped: tokens issued on the webmcp surface are never redeemable (policy/confirmation),
 * and a model has no use for one; it only needs the summary and the instruction to continue on the page.
 */
export function outcomeResponse(outcome: CapabilityOutcome<unknown>, requestId: string): Response {
  const { data, sources, confirmation, handoffUrl, retrievedAt } = outcome;
  return jsonResponse(
    {
      ok: true,
      data,
      sources,
      ...(confirmation ? { confirmation: { expiresAt: confirmation.expiresAt, summary: confirmation.summary, requiresUi: true } } : {}),
      ...(handoffUrl ? { handoffUrl } : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
    },
    { requestId },
  );
}

/**
 * Cross-site defence for the GET manifest. The browser's own `Sec-Fetch-Site` is authoritative
 * when present; a cross-site or same-site (sibling subdomain) fetch is refused. Absent metadata
 * (non-browser clients, very old browsers) is allowed: the same-origin policy already prevents a
 * cross-origin page from reading the response, so this is defence in depth, not the boundary.
 */
export function assertSameOriginFetch(request: Request): Result<void, CapabilityError> {
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (!site || site === 'same-origin' || site === 'none') return ok(undefined);
  return err(new CapabilityError('forbidden', SAME_ORIGIN_MESSAGE, { reason: 'origin' }));
}
