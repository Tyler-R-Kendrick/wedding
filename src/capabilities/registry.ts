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

export const registry = new CapabilityRegistryImpl();
export const registerCapability = <C extends AnyCapability>(c: C): C => registry.register(c);
