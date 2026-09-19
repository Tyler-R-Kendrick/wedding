import type { AnyCapability, CapabilityContext, CapabilityOutcome } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, type Result } from '@/contracts/result';
import { aiCapabilities } from './ai';
import { contentCapabilities } from './content';
import { invoke } from './invoke';
import { mediaCapabilities } from './media';
import { mediaAiCapabilities } from './mediaai';
import { navigateTo } from './navigate_to';
import { opsCapabilities } from './ops';
import { registry } from './registry';
import { rsvpSwarmCapabilities } from './rsvp';
import { siteStatus } from './site_status';
import { identityCapabilities } from './identity';
import { transportGiftsReservationsCapabilities } from './transport_gifts_reservations';
import { travelCapabilities } from './travel';

/**
 * Registration point. Feature swarms add ONE line each importing their module's
 * capability list, e.g. `import { rsvpCapabilities } from './rsvp';` and spread it below.
 */
export const BUILTIN_CAPABILITIES: readonly AnyCapability[] = [
  siteStatus,
  navigateTo,
  ...contentCapabilities,
  ...identityCapabilities,
  ...rsvpSwarmCapabilities,
  ...travelCapabilities,
  ...transportGiftsReservationsCapabilities,
  ...mediaCapabilities,
  ...mediaAiCapabilities,
  ...aiCapabilities,
  ...opsCapabilities,
];

/*
 * Idempotent on purpose: see the note on `registry` in ./registry.ts. This line runs as an import
 * side effect, and a dev-server module re-evaluation runs it again against a registry that is
 * already full — new descriptor objects, identical names — which `registerAll` refuses, so every
 * route that imports a capability answered 500 until the server was restarted. Registering what is
 * missing keeps the duplicate check intact for the case it exists for.
 */
for (const capability of BUILTIN_CAPABILITIES) {
  if (!registry.has(capability.name)) registry.register(capability);
}

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
