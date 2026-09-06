import 'server-only';
import { registry as appRegistry } from '@/capabilities';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import type { AnyCapability, CapabilityRegistry } from '@/contracts/capability';
import { WEBMCP_TEST_CAPABILITIES } from './fixtures';
import { isTestInjectionEnabled } from './test-principal';

/**
 * The registry the WebMCP bridge reads.
 *
 * It is a *view*: the app's real registry plus, under the test gate only, the synthetic fixtures.
 * The fixtures live in their own `CapabilityRegistryImpl` and are never written into the process-
 * wide registry, so:
 *
 *  - `/api/capabilities/*` cannot see them. That matters because `ui` is the one surface where an
 *    explicit confirmation is redeemable, and `webmcp_test_draft` mints a real token for
 *    `webmcp_test_explicit`. A gate slip must not put a redeemable test fixture on the live UI door.
 *  - No HTTP request mutates the running app's capability set. Installation happens once, here, at
 *    module load, under the same `NODE_ENV=test` + `TEST_AUTH_SECRET` gate as the principal
 *    injector — not as a side effect of serving a request (which used to happen before the CSRF
 *    check and before authorization).
 *
 * Both belts, plus `exposure.ui: false` on every fixture, are deliberate: this is the one piece of
 * the level that could turn a misconfigured deploy into an actual bypass.
 */
const fixtureRegistry = new CapabilityRegistryImpl();
if (isTestInjectionEnabled()) fixtureRegistry.registerAll(WEBMCP_TEST_CAPABILITIES);

/** Test-only introspection: are the synthetic fixtures installed in this process? */
export const webMcpFixturesInstalled = (): boolean => fixtureRegistry.names().length > 0;

export const webMcpRegistry: CapabilityRegistry = {
  get(name: string): AnyCapability | undefined {
    // The app's own capabilities always win: a fixture can never shadow a real one.
    return appRegistry.get(name) ?? fixtureRegistry.get(name);
  },
  list(filter = {}): AnyCapability[] {
    // Same filter, applied by the same implementation, to both halves.
    return [...appRegistry.list(filter), ...fixtureRegistry.list(filter)].sort((a, b) => a.name.localeCompare(b.name));
  },
};
