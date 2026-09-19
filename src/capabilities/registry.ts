import type { AnyCapability, CapabilityExposure, CapabilityRegistry } from '@/contracts/capability';
import type { FlagValues } from '@/contracts/flags';
import type { Principal } from '@/contracts/principal';
import { authorize } from '@/policy/entitlements';

/**
 * Process-wide capability registry. Feature swarms register their capabilities from
 * `src/capabilities/index.ts` (one import line each). Listing filters by exposure surface,
 * principal (auth level + entitlements) and flags so UI menus, AI tool lists and WebMCP
 * registrations all derive from the same source. Listing is never authorization:
 * `invoke` re-checks everything.
 */
export class CapabilityRegistryImpl implements CapabilityRegistry {
  private readonly items = new Map<string, AnyCapability>();

  register<C extends AnyCapability>(capability: C): C {
    const existing = this.items.get(capability.name);
    if (existing && existing !== capability) {
      throw new Error(`capability "${capability.name}" is already registered`);
    }
    this.items.set(capability.name, capability);
    return capability;
  }

  registerAll(capabilities: readonly AnyCapability[]): void {
    for (const c of capabilities) this.register(c);
  }

  get(name: string): AnyCapability | undefined {
    return this.items.get(name);
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  names(): string[] {
    return [...this.items.keys()].sort();
  }

  list(filter: { exposure?: keyof CapabilityExposure; principal?: Principal; flags?: FlagValues } = {}): AnyCapability[] {
    const out: AnyCapability[] = [];
    for (const c of this.items.values()) {
      if (filter.exposure && !c.exposure[filter.exposure]) continue;
      if (filter.flags && c.flag && !filter.flags[c.flag]) continue;
      if (filter.principal && !authorize(c, filter.principal).ok) continue;
      out.push(c);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Tests only. */
  clear(): void {
    this.items.clear();
  }
}

/**
 * One registry per process, including across a hot reload.
 *
 * `src/capabilities/index.ts` calls `registerAll` as an import side effect, and `register` throws
 * when a name arrives twice carrying a different object — which is exactly what a real collision
 * looks like, and exactly what a dev-server module re-evaluation also looks like: the new module
 * instance builds new descriptor objects with the same names, the module-scoped registry from the
 * previous evaluation is still alive behind them, and every route that imports a capability
 * answers 500 with `capability "list_my_events" is already registered`. Recovering needs a
 * restart, because touching a file only re-evaluates again.
 *
 * The check itself is right and stays: two different capabilities answering to one name is a bug
 * worth refusing to boot over. What was wrong is that populating the registry was not idempotent.
 * So the instance is pinned to `globalThis` — the same thing Next.js documents for a database
 * client — so that a re-evaluation finds the registry it already filled rather than a second empty
 * one, and `index.ts` registers only the names that are missing. A genuine collision still throws,
 * because two different descriptors never share a name in the same build.
 */
const GLOBAL_KEY = Symbol.for('wedding.capabilityRegistry');
type RegistryHost = typeof globalThis & { [GLOBAL_KEY]?: CapabilityRegistryImpl };

export const registry: CapabilityRegistryImpl =
  (globalThis as RegistryHost)[GLOBAL_KEY] ?? ((globalThis as RegistryHost)[GLOBAL_KEY] = new CapabilityRegistryImpl());
export const registerCapability = <C extends AnyCapability>(c: C): C => registry.register(c);
