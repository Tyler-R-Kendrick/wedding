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
 *   1 resolve + exposure + flag, 2 authorize, 3 step-up, 4 confirmation (surface),
 *   5 validate input, 6 confirmation (token), 7 idempotency replay, 8 handler,
 *   9 validate output + cap, 10 audit (always).
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

  // 2. authorize (auth level + entitlements; handlers re-check row ownership)
  //
  // Authorization runs BEFORE input validation, and the order is deliberate (level-13 review N5).
  // It used to be the other way round, which meant an `ai`/`webmcp` caller was told to fix its
  // input for a capability that could never complete on its surface, and a caller who had guessed a
  // capability name learned its input schema before learning it was not allowed to call it.
  // Everything from here to step 6 depends only on the descriptor and the principal, so it can all
  // be decided without looking at the input at all; validation is what happens once the caller has
  // been established as someone who could act on a valid input.
  //
  // The naive version of the N5 fix — hoisting only the confirmation refusal above step 2 — would
  // have hoisted it above this too, telling an UNAUTHORIZED caller that the capability exists and
  // wants a confirmation on the website. That is a worse leak than the wasted round trip it saved.
  const authz = authorize(descriptor, ctx.principal);
  if (!authz.ok) return finish(err(authz.error));
  // 2b. anonymous callers all share one identity, so they can neither hold idempotency keys
  //     (one scope for everyone) nor confirm anything (one confirmation identity for everyone)
  if (ctx.principal.kind === 'anonymous') {
    if (ctx.idempotencyKey) {
      return finish(err(new CapabilityError('validation', 'Please sign in before retrying this request.', { issues: [{ path: 'idempotencyKey', message: 'idempotency keys require a signed-in guest' }] })));
    }
    if (descriptor.confirmation === 'explicit') {
      return finish(err(new CapabilityError('forbidden', 'Please sign in to confirm this.')));
    }
  }

  // 2c. per-principal rate limit, inside the pipeline so every entry point shares one budget. The
  //     JSON route additionally limits by IP before a principal exists; this is the authenticated
  //     bucket, and it is what stops a signed-in guest driving unbounded writes (and outbox rows and
  //     e-mail jobs) through a server action, which reaches `invoke` without passing that route.
  //
  //     Since the reorder this also meters calls that carry invalid input. It used to not: a caller
  //     could send malformed bodies at whatever rate it liked and pay nothing, because validation
  //     answered first. Metering them is the correct behaviour for an authenticated bucket.
  if (services.limiter) {
    const decision = await services.limiter.consume(`cap:${principalKey(actor)}`, 'capability');
    if (!decision.allowed) {
      return finish(err(new CapabilityError('rate_limited', 'You have tried that a few times. Please wait a moment and try again.', { retryAfterMs: decision.retryAfterMs })));
    }
  }

  // 3. step-up
  if (descriptor.stepUp) {
    const fresh = requireFreshSession(ctx.principal, ctx.now);
    if (!fresh.ok) return finish(err(fresh.error));
  }

  // 4. confirmation, part one: which surface may complete this at all. A human confirms on the
  //    website; models and WebMCP can only draft. This half needs no input, so it answers before
  //    validation — an agent asking for something only the website can finish is told that, instead
  //    of being sent away to fix fields for a call that could never have completed (review N5).
  //
  // `explicit` is website-only for every kind. `inline` is website-only when the capability CHANGES
  // OUR OWN STATE, which until level 12 nothing enforced: the check read `=== 'explicit'`, harmless
  // while `ui` was the only surface, and no longer harmless once the concierge began deriving a tool
  // list from `exposure.ai`. Four AI-exposed mutations are `inline` — `delete_my_travel_profile`,
  // `update_my_travel_profile`, `add_trip_item`, `remove_trip_item` — and the first takes no
  // required input, so the router could plan it straight from a sentence. It was denied in practice
  // only because the strict input schema rejected the router's extra `query` key: defence by
  // accident, one `.strip()` away from deleting a guest's travel profile because they typed "please
  // delete my travel profile". `inline` means "the form asks before it acts", and off the website
  // there is no form and no token that could stand in for one, so such a call is simply refused.
  // (That accidental defence is also gone now in a second way: the schema no longer answers first.)
  //
  // `external` is deliberately NOT included. A handoff commits nothing: it returns a provider URL
  // and logs that it did. Level 09 exposes `open_gift_link`, `open_reservation_link` and
  // `open_booking_link` to an assistant on purpose, so that asking "where are they registered?"
  // gets an answer, and the guest's own click on the link is the commitment.
  //
  // Level 13 adds the one documented way out: `agentConfirmable: true` is a descriptor stating that
  // this particular `inline` mutation really is safe to complete unattended (contract addition,
  // src/contracts/capability.ts). Without it honoured here the flag would be dead API — the WebMCP
  // layer would offer an opt-out the pipeline then refused anyway. It cannot relax `explicit`, and
  // `transaction` keeps its own upgrade in src/webmcp/server/invoke.ts as a second belt. Nothing
  // that ships sets it today; only the WebMCP test fixtures do, behind the test gate.
  //
  // `agentConfirmable` opts out for an inline ACTION and nothing else. The contract three lines up
  // says it "never relaxes `explicit`, `transaction` or `external`", and this code did not honour
  // that for a transaction: `agentConfirmable` disarmed the refusal there too. On `webmcp` that was
  // invisible, because `effectiveWebMcpDescriptor` re-upgrades a transaction anyway; on `ai` there
  // is no second belt, so a `transaction` + `inline` + `agentConfirmable` descriptor would have
  // committed unattended for any guest fresh enough to pass step-up. A transaction is money,
  // identity or an external commitment — `defineCapability` forces `stepUp` on it for that reason —
  // and is never something an agent completes alone.
  const changesOurState = descriptor.kind === 'action' || descriptor.kind === 'transaction';
  const agentMayComplete = descriptor.agentConfirmable === true && descriptor.kind === 'action';
  const inlineNeedsAPage = descriptor.confirmation === 'inline' && changesOurState && !agentMayComplete;
  if (descriptor.confirmation === 'explicit' || inlineNeedsAPage) {
    if (surface !== REDEEMABLE_SURFACE) {
      return finish(err(new CapabilityError('confirmation_required', 'Please confirm this on the website.', { reason: 'requires_ui' })));
    }
  }

  // 5. validate input — untrusted input still never reaches a handler unvalidated; it is only that
  //    the caller now has to be someone this capability would run for before we discuss its fields.
  const parsed = descriptor.input.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    return finish(err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues })));
  }
  const input = parsed.data;

  // 6. confirmation, part two: the token itself. `payloadHash` is derived from VALIDATED input —
  //    it is what binds a confirmation token, and later the idempotency reservation, to the exact
  //    payload the guest approved — so this half cannot move above step 5, and it is why the whole
  //    of confirmation could not simply be hoisted.
  const payloadHash = stableHash(input);
  let confirmed: VerifiedConfirmation | undefined;
  if (descriptor.confirmation === 'explicit') {
    if (!services.confirmation) {
      return finish(err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, new Error('confirmation service not wired'))));
    }
    const verified = services.confirmation.verify(ctx.confirmationToken, { capability: descriptor.name, principalRef: actor, payloadHash }, ctx.now);
    if (!verified.ok) return finish(err(verified.error));
    confirmed = verified.value;
  }

  /**
   * Step 9's size cap. It belongs to the surface receiving the answer, not to the stored record,
   * so a REPLAY is capped too (review N2). The scope stays `${name}:${principal}` deliberately —
   * adding the surface to it would let one key run the handler once per surface, which is the
   * opposite of what an idempotency key promises — and the cap is applied on the way out instead.
   * Without this a `ui` call could store a result larger than an assistant may receive and the same
   * key, replayed on `ai`/`webmcp`, would hand it over: the replay return below is upstream of
   * step 9 and skipped every check in it.
   */
  const overSizeForSurface = (data: unknown): CapabilityError | null => {
    if (surface !== 'ai' && surface !== 'webmcp') return null;
    const max = descriptor.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const size = JSON.stringify(data).length;
    if (size <= max) return null;
    return new CapabilityError('validation', 'That result is too large to show here. Try a narrower request.', { maxOutputChars: max, size });
  };

  // 7. idempotency: reserve first, so concurrent retries can never both run the handler
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
      if (descriptor.replayable === false) {
        // Nothing was stored to replay. Take the key over and run again, so the handler's own
        // authorization decides — a result whose preconditions have since been withdrawn must not
        // come back from a cache.
        try {
          await services.idempotency.release(idemScope, ctx.idempotencyKey);
          claim = await services.idempotency.reserve(idemScope, ctx.idempotencyKey, payloadHash);
        } catch (cause) {
          return finish(err(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, cause)));
        }
        if (!claim.reserved) {
          return finish(err(new CapabilityError('conflict', 'That request is still being processed. Please wait a moment before retrying.')));
        }
      } else {
        const replayed = claim.existing.response as CapabilityOutcome<O>;
        const tooBig = overSizeForSurface(replayed?.data);
        if (tooBig) return finish(err(tooBig));
        return finish(ok(replayed), { replay: true });
      }
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

  // 7b. consume the confirmation nonce: a token is accepted once, ever (after the replay check, so an
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

  // 8. handler
  let result: Result<CapabilityOutcome<O>, CapabilityError>;
  try {
    result = await descriptor.handler(ctx, input);
  } catch (cause) {
    services.logger?.error({ err: cause, capability: descriptor.name, requestId: ctx.requestId }, 'capability handler threw');
    return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE, undefined, cause));
  }
  if (!result.ok) return fail(result.error);

  // 9. validate output, cap size
  const outParsed = descriptor.output.safeParse(result.value.data);
  if (!outParsed.success) {
    services.logger?.error({ capability: descriptor.name, requestId: ctx.requestId, issues: outParsed.error.issues.length }, 'capability output failed schema');
    return fail(new CapabilityError('internal', INTERNAL_ERROR_MESSAGE));
  }
  const outcome: CapabilityOutcome<O> = { ...result.value, data: outParsed.data, sources: result.value.sources ?? [] };
  const oversize = overSizeForSurface(outcome.data);
  if (oversize) return fail(oversize);

  if (reserved && ctx.idempotencyKey && services.idempotency) {
    try {
      // `replayable: false` never persists the body: releasing the reservation leaves nothing at
      // all in the public idempotency table, and a later repeat re-runs under every gate.
      if (descriptor.replayable === false) await services.idempotency.release(idemScope, ctx.idempotencyKey);
      else await services.idempotency.set(idemScope, ctx.idempotencyKey, payloadHash, outcome);
    } catch (cause) {
      // The action happened; a retry within the reservation TTL sees "in progress" and then re-runs. Never hide the outcome.
      services.logger?.error({ err: cause, capability: descriptor.name, requestId: ctx.requestId }, 'idempotency outcome could not be stored');
    }
  }

  // 10. audit success
  return finish(ok(outcome));
}
