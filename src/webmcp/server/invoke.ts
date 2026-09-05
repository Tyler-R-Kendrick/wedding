import type { AnyCapability, CapabilityContext, CapabilityOutcome, CapabilityRegistry } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, type Result } from '@/contracts/result';
import { invoke } from '@/capabilities/invoke';
import { requiresHumanConfirmation } from '../descriptors';

/**
 * How the WebMCP bridge runs a capability. The context MUST carry `surface: 'webmcp'` (the
 * pipeline then hides non-webmcp capabilities, caps output, and refuses explicit confirmation).
 * Transactions and external handoffs are additionally invoked as `confirmation: 'explicit'`
 * whatever the descriptor says, so ADR-0002 rule 4 ("never from an agent without a human
 * confirming in the UI") holds even for a descriptor that only asked for inline confirmation.
 * The pipeline still audits the denial. Unknown names are `not_found` (never leaks the registry).
 */
export function effectiveWebMcpDescriptor(descriptor: AnyCapability): AnyCapability {
  if (requiresHumanConfirmation(descriptor) && descriptor.confirmation !== 'explicit') {
    return { ...descriptor, confirmation: 'explicit' };
  }
  return descriptor;
}

export async function invokeForWebMcp(
  registry: Pick<CapabilityRegistry, 'get'>,
  name: string,
  ctx: CapabilityContext,
  rawInput: unknown,
): Promise<Result<CapabilityOutcome<unknown>, CapabilityError>> {
  if (ctx.surface !== 'webmcp') throw new Error('invokeForWebMcp requires a webmcp context');
  const descriptor = registry.get(name);
  if (!descriptor) return err(new CapabilityError('not_found', 'That action is not available.'));
  return invoke(effectiveWebMcpDescriptor(descriptor), ctx, rawInput);
}
