import type { AnyCapability, CapabilityContext, CapabilityOutcome, CapabilityRegistry } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, type Result } from '@/contracts/result';
import { invoke } from '@/capabilities/invoke';
import { authorize } from '@/policy/entitlements';
import { requiresHumanConfirmation } from '../descriptors';

/**
 * How the WebMCP bridge runs a capability. The context MUST carry `surface: 'webmcp'` (the
 * pipeline then hides non-webmcp capabilities, caps output, and refuses explicit confirmation).
 *
 * Anything needing a human — `explicit`, `transaction`, `external`, and `inline` unless the
 * descriptor opts out with `agentConfirmable` — is invoked as `explicit`, so ADR-0002 rule 4
 * ("never from an agent without a human confirming in the UI") holds even for a descriptor that
 * only asked for inline confirmation. The pipeline enforces nothing at all for `inline`; on a
 * surface with no page and no human, that would mean no confirmation happened.
 */
export function effectiveWebMcpDescriptor(descriptor: AnyCapability): AnyCapability {
  if (requiresHumanConfirmation(descriptor) && descriptor.confirmation !== 'explicit') {
    return { ...descriptor, confirmation: 'explicit' };
  }
  return descriptor;
}

/**
 * The one answer for everything the caller may not see: identical body for "no such capability",
 * "exists but is not exposed to WebMCP", "needs a session" and "needs an entitlement". Distinct
 * answers would let anyone sort guessed names into those buckets, which is a map of the couple's
 * unreleased features and of the role that gates each one. The manifest is the only place a caller
 * learns what exists.
 */
const notAvailable = () => new CapabilityError('not_found', 'That action is not available.');

/**
 * Could this capability appear in the current principal's manifest? Anything else gets the uniform
 * answer above. This is **not** the authorization check: `invoke` still runs the real one and the
 * audit row still records the true code (`unauthenticated`, `forbidden`, `not_found`). This only
 * decides how much the *response* is allowed to say.
 */
function visibleTo(descriptor: AnyCapability, ctx: CapabilityContext): boolean {
  if (!descriptor.exposure.webmcp) return false;
  if (descriptor.flag && !ctx.flags[descriptor.flag]) return false;
  return authorize(descriptor, ctx.principal).ok;
}

export async function invokeForWebMcp(
  registry: Pick<CapabilityRegistry, 'get'>,
  name: string,
  ctx: CapabilityContext,
  rawInput: unknown,
): Promise<Result<CapabilityOutcome<unknown>, CapabilityError>> {
  if (ctx.surface !== 'webmcp') throw new Error('invokeForWebMcp requires a webmcp context');
  const descriptor = registry.get(name);
  if (!descriptor) return err(notAvailable());

  // The pipeline runs either way: it is what authorizes, and what writes the audit row carrying the
  // real reason. Only the reply is masked, and only for a capability this principal cannot see —
  // so a caller who *can* see a tool still gets the specific error they need to act on.
  const visible = visibleTo(descriptor, ctx);
  const result = await invoke(effectiveWebMcpDescriptor(descriptor), ctx, rawInput);
  if (!result.ok && !visible) return err(notAvailable());
  return result;
}
