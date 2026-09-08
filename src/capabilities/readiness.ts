import type { AnyCapability } from '@/contracts/capability';
import { READINESS_GATED, type FeatureFlag, type FlagValues } from '@/contracts/flags';

/**
 * Readiness-awareness for every DERIVED list of capabilities, in one place.
 *
 * `registry.list` filters on `exposure`, `flags` and `authorize`. It cannot filter on readiness:
 * a readiness switch is a row in `feature_flags` (admin action plus a legal sign-off, ADR-0006),
 * so reading it is asynchronous and `list` is synchronous — deliberately, because it is called
 * from render paths. `invoke` step 1 checks BOTH the env flag and readiness, and fails closed
 * without a readiness service. Any list that checks only the env flag therefore advertises a tool
 * that always answers `feature_disabled` — noise at best, and at worst a disclosure that a legally
 * gated feature (BIPA face matching, third-party media processing) exists at all.
 *
 * Level 13 solved that for the WebMCP manifest alone: the route resolved readiness and passed an
 * `unreadyFlags` set in. The AI router did not, so `exposure.ai` and `exposure.webmcp` answered
 * differently for the same capability. This module is that resolution, shared: the WebMCP manifest
 * route and the concierge both call `unreadyGatedFlags` and both filter with `withoutUnready`.
 *
 * Inert today — no READINESS_GATED capability is `ai`- or `webmcp`-exposed — which is exactly why
 * it belongs in one function now rather than in whichever surface next remembers to do it.
 */

/**
 * Readiness-gated flags that are ON in the environment but whose persisted switch is off.
 * Flags already off in the environment are excluded by the plain flag filter, so they are skipped
 * here and never cause a database read.
 *
 * `isReady` is injected rather than imported so this module stays free of the database: the
 * pipeline's own `services.readiness` is the same function, so a surface holding a capability
 * context passes what it already has.
 */
export async function unreadyGatedFlags(
  flags: FlagValues,
  isReady: ((flag: FeatureFlag) => Promise<boolean>) | undefined,
): Promise<ReadonlySet<FeatureFlag>> {
  const unready = new Set<FeatureFlag>();
  for (const flag of READINESS_GATED) {
    if (!flags[flag]) continue;
    // No readiness service means fail closed, matching `invoke` step 1: the flag counts as unready.
    if (!isReady || !(await isReady(flag))) unready.add(flag);
  }
  return unready;
}

/** Drop capabilities whose flag is on in the environment but not switched on in the database. */
export function withoutUnready<C extends Pick<AnyCapability, 'flag'>>(
  capabilities: readonly C[],
  unready: ReadonlySet<FeatureFlag> | undefined,
): C[] {
  if (!unready || unready.size === 0) return [...capabilities];
  return capabilities.filter((c) => !(c.flag && unready.has(c.flag)));
}
