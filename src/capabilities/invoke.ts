import type { AuditAction, AuditOutcome } from '@/contracts/audit';
import type { CapabilityContext, CapabilityDescriptor, CapabilityOutcome } from '@/contracts/capability';
import { CapabilityError, type CapabilityErrorCode } from '@/contracts/errors';
import { READINESS_GATED } from '@/contracts/flags';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import { stableHash } from '@/lib/crypto';
import { authorize } from '@/policy/entitlements';
import { principalKey, REDEEMABLE_SURFACE, type VerifiedConfirmation } from '@/policy/confirmation';
import { requireFreshSession } from '@/policy/stepUp';
import { pipelineServices } from './services';

export const DEFAULT_MAX_OUTPUT_CHARS = 16_000;
export const INTERNAL_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';

const DENIED_CODES: ReadonlySet<CapabilityErrorCode> = new Set([
  'unauthenticated', 'forbidden', 'step_up_required', 'confirmation_required', 'feature_disabled', 'not_found', 'rate_limited',
]);

/**
 * The single invocation pipeline (see src/contracts/capability.ts):
 *   1 resolve + exposure + flag, 2 validate input, 3 authorize, 4 step-up, 5 confirmation,
 *   6 idempotency replay, 7 handler, 8 validate output + cap, 9 audit (always).
 */
export async function invoke<I, O>(
  descriptor: CapabilityDescriptor<I, O>,
  ctx: CapabilityContext,
  rawInput: unknown,
): Promise<Result<CapabilityOutcome<O>, CapabilityError>> {
  const started = performance.now();
  const surface = ctx.surface ?? 'ui';
  const services = pipelineServices(ctx);
  const actor = toPrincipalRef(ctx.principal);
  // Audit fingerprint of the input: keyed (unguessable without the server key) and only for
  // capabilities that change something; reads and navigation record no hash at all.
  const consequential = descriptor.kind !== 'read' && descriptor.kind !== 'navigate';
  const inputHash = consequential && services.hashInput ? services.hashInput(rawInput ?? null) : undefined;

  const finish = async (
    result: Result<CapabilityOutcome<O>, CapabilityError>,
    extra: Record<string, unknown> = {},
  ): Promise<Result<CapabilityOutcome<O>, CapabilityError>> => {
    const durationMs = Math.round(performance.now() - started);
    let action: AuditAction;
    let outcome: AuditOutcome;
    if (result.ok) {
      action = 'capability.invoked';
      outcome = 'success';
    } else if (DENIED_CODES.has(result.error.code)) {
      action = 'capability.denied';
      outcome = 'denied';
    } else {
      action = 'capability.failed';
      outcome = 'failed';
    }
    const metadata: Record<string, unknown> = {
      kind: descriptor.kind,
      surface,
      ...(inputHash ? { inputHash } : {}),
      durationMs,
      ...(result.ok ? {} : { errorCode: result.error.code }),
      ...extra,
    };
    try {
      await ctx.audit.record({ actor, action, target: { type: 'capability', id: descriptor.name }, outcome, requestId: ctx.requestId, metadata });
    } catch (auditError) {
      // An audit failure must never turn into a silent success for consequential capabilities.
      services.logger?.error({ err: auditError, capability: descriptor.name, requestId: ctx.requestId }, 'audit sink failed');
      if (descriptor.kind !== 'read' && descriptor.kind !== 'navigate') {
        return err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, auditError));
      }
    }
    services.metrics?.histogram('capability.duration_ms', durationMs, { capability: descriptor.name, outcome });
    services.metrics?.counter('capability.invocations', 1, { capability: descriptor.name, outcome });
    return result;
  };

  // 1. exposure + flag (readiness-gated flags fail closed without a readiness service)
  if (!descriptor.exposure[surface]) {
    return finish(err(new CapabilityError('not_found', 'That action is not available here.')));
  }
  if (descriptor.flag) {
    if (!ctx.flags[descriptor.flag]) {
      return finish(err(new CapabilityError('feature_disabled', 'This feature is not available right now.')));
    }
    if (READINESS_GATED.includes(descriptor.flag)) {
      const ready = services.readiness ? await services.readiness(descriptor.flag) : false;
      if (!ready) return finish(err(new CapabilityError('feature_disabled', 'This feature is not available right now.')));
    }
  }

  // 2. validate input
  const parsed = descriptor.input.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    return finish(err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues })));
  }
  const input = parsed.data;

  // 3. authorize (auth level + entitlements; handlers re-check row ownership)
  const authz = authorize(descriptor, ctx.principal);
  if (!authz.ok) return finish(err(authz.error));
  // 3b. anonymous callers all share one identity, so they can neither hold idempotency keys
  //     (one scope for everyone) nor confirm anything (one confirmation identity for everyone)
  if (ctx.principal.kind === 'anonymous') {
    if (ctx.idempotencyKey) {
      return finish(err(new CapabilityError('validation', 'Please sign in before retrying this request.', { issues: [{ path: 'idempotencyKey', message: 'idempotency keys require a signed-in guest' }] })));
    }
    if (descriptor.confirmation === 'explicit') {
      return finish(err(new CapabilityError('forbidden', 'Please sign in to confirm this.')));
    }
  }

  // 4. step-up
  if (descriptor.stepUp) {
    const fresh = requireFreshSession(ctx.principal, ctx.now);
    if (!fresh.ok) return finish(err(fresh.error));
  }

  // 5. explicit confirmation: a human confirms on the website; models and WebMCP can only draft
  const payloadHash = stableHash(input);
  let confirmed: VerifiedConfirmation | undefined;
  if (descriptor.confirmation === 'explicit') {
    if (surface !== REDEEMABLE_SURFACE) {
      return finish(err(new CapabilityError('confirmation_required', 'Please confirm this on the website.', { reason: 'requires_ui' })));
    }
    if (!services.confirmation) {
      return finish(err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, new Error('confirmation service not wired'))));
    }
    const verified = services.confirmation.verify(ctx.confirmationToken, { capability: descriptor.name, principalRef: actor, payloadHash }, ctx.now);
    if (!verified.ok) return finish(err(verified.error));
    confirmed = verified.value;
  }

  // 6. idempotency: reserve first, so concurrent retries can never both run the handler
  const idemScope = `${descriptor.name}:${principalKey(actor)}`;
  let reserved = false;
  const isMutation = descriptor.kind === 'action' || descriptor.kind === 'transaction' || descriptor.kind === 'external';
  if (descriptor.idempotent && isMutation) {
    // Idempotency is a guarantee, not an option: no store means we cannot make it, no key means the caller cannot retry safely.
    if (!services.idempotency) {
      return finish(err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, new Error('idempotency store not wired'))));
    }
    if (!ctx.idempotencyKey) {
      return finish(err(new CapabilityError('validation', 'idempotencyKey required', { issues: [{ path: 'idempotencyKey', message: 'idempotencyKey required' }] })));
    }
  }
  if (descriptor.idempotent && ctx.idempotencyKey && services.idempotency) {
    let claim: Awaited<ReturnType<typeof services.idempotency.reserve>>;
    try {
      claim = await services.idempotency.reserve(idemScope, ctx.idempotencyKey, payloadHash);
    } catch (cause) {
      return finish(err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, cause)));
    }
    if (!claim.reserved) {
      if (claim.existing.status === 'in_progress') {
        return finish(err(new CapabilityError('conflict', 'That request is still being processed. Please wait a moment before retrying.')));
      }
      if (claim.existing.payloadHash !== payloadHash) {
        return finish(err(new CapabilityError('conflict', 'That request was already made with different details.')));
      }
      return finish(ok(claim.existing.response as CapabilityOutcome<O>), { replay: true });
    }
    reserved = true;
  }
  /** A failure after the reservation must release it, so a retry re-runs instead of seeing "in progress". */
  const fail = async (error: CapabilityError) => {
    if (reserved && ctx.idempotencyKey && services.idempotency) {
      try {
        await services.idempotency.release(idemScope, ctx.idempotencyKey);
      } catch (cause) {
        services.logger?.error({ err: cause, capability: descriptor.name, requestId: ctx.requestId }, 'idempotency reservation could not be released');
      }
    }
    return finish(err(error));
  };

  // 6b. consume the confirmation nonce: a token is accepted once, ever (after the replay check, so an
  //     honest retry of a completed request still replays instead of burning a second confirmation)
  if (confirmed) {
    if (!services.idempotency) {
      return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, new Error('idempotency store not wired; cannot consume confirmation nonces')));
    }
    const nonceScope = `confirm:${descriptor.name}:${principalKey(actor)}`;
    const ttlSeconds = Math.max(60, Math.ceil((Date.parse(confirmed.expiresAt) - ctx.now.getTime()) / 1000) + 60);
    let claim: Awaited<ReturnType<typeof services.idempotency.reserve>>;
    try {
      claim = await services.idempotency.reserve(nonceScope, confirmed.nonce, payloadHash, ttlSeconds);
    } catch (cause) {
      return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, cause));
    }
    if (!claim.reserved) {
      return fail(new CapabilityError('confirmation_required', 'That confirmation was already used — please review again.', { reason: 'used' }));
    }
  }

  // 7. handler
  let result: Result<CapabilityOutcome<O>, CapabilityError>;
  try {
    result = await descriptor.handler(ctx, input);
  } catch (cause) {
    services.logger?.error({ err: cause, capability: descriptor.name, requestId: ctx.requestId }, 'capability handler threw');
    return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, cause));
  }
  if (!result.ok) return fail(result.error);

  // 8. validate output, cap size
  const outParsed = descriptor.output.safeParse(result.value.data);
  if (!outParsed.success) {
    services.logger?.error({ capability: descriptor.name, requestId: ctx.requestId, issues: outParsed.error.issues.length }, 'capability output failed schema');
    return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE));
  }
  const outcome: CapabilityOutcome<O> = { ...result.value, data: outParsed.data, sources: result.value.sources ?? [] };
  if (surface === 'ai' || surface === 'webmcp') {
    const max = descriptor.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const size = JSON.stringify(outcome.data).length;
    if (size > max) {
      return fail(new CapabilityError('validation', 'That result is too large to show here. Try a narrower request.', { maxOutputChars: max, size }));
    }
  }

  if (reserved && ctx.idempotencyKey && services.idempotency) {
    try {
      await services.idempotency.set(idemScope, ctx.idempotencyKey, payloadHash, outcome);
    } catch (cause) {
      // The action happened; a retry within the reservation TTL sees "in progress" and then re-runs. Never hide the outcome.
      services.logger?.error({ err: cause, capability: descriptor.name, requestId: ctx.requestId }, 'idempotency outcome could not be stored');
    }
  }

  // 9. audit success
  return finish(ok(outcome));
}
