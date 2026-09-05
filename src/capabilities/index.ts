import type { AnyCapability, CapabilityContext, CapabilityOutcome } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, type Result } from '@/contracts/result';
import { invoke } from './invoke';
import { navigateTo } from './navigate_to';
import { registry } from './registry';
import { rsvpSwarmCapabilities } from './rsvp';
import { siteStatus } from './site_status';

/**
 * Registration point. Feature swarms add ONE line each importing their module's
 * capability list, e.g. `import { rsvpCapabilities } from './rsvp';` and spread it below.
 */
export const BUILTIN_CAPABILITIES: readonly AnyCapability[] = [siteStatus, navigateTo, ...rsvpSwarmCapabilities];

registry.registerAll(BUILTIN_CAPABILITIES);

export { registry, invoke, siteStatus, navigateTo };
export { createCapabilityContext, appServices, type AppServices } from './context';
export { requireService, MemoryIdempotencyStore, type IdempotencyStore, type PipelineServices } from './services';
export { INTERNAL_ROUTES, isInternalRoute } from './routes';

/** Looks the capability up by name and runs the pipeline. Unknown names are `not_found` (never leaks the registry). */
export async function invokeByName(name: string, ctx: CapabilityContext, rawInput: unknown): Promise<Result<CapabilityOutcome<unknown>, CapabilityError>> {
  const descriptor = registry.get(name);
  if (!descriptor) return err(new CapabilityError('not_found', 'That action is not available.'));
  return invoke(descriptor, ctx, rawInput);
}
