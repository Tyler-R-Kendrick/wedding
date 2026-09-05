import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';

/**
 * Typed extension points on Your Weekend. Swarm G (rides / transport benefits) fills
 * `transport`; Swarm F (flights, hotel, trip items) fills `trip`. Until a provider is
 * registered, the slot renders an honest placeholder — never invented content.
 */
export const WEEKEND_SLOT_KINDS = ['transport', 'trip'] as const;
export type WeekendSlotKind = (typeof WEEKEND_SLOT_KINDS)[number];

export interface WeekendSlotItem {
  label: string;
  detail?: string;
  /** Internal route or allow-listed external URL (the owning swarm validates it). */
  href?: string;
}

export type WeekendSlot =
  | { kind: WeekendSlotKind; status: 'placeholder'; placeholder: true; title: string; body: string; owner: string }
  | { kind: WeekendSlotKind; status: 'ready'; placeholder: false; title: string; items: WeekendSlotItem[]; retrievedAt?: string }
  | { kind: WeekendSlotKind; status: 'unavailable'; placeholder: false; title: string; body: string };

export interface WeekendSlotContext {
  principal: Principal;
  guestId: string;
  db: Db;
  now: Date;
}

export type WeekendSlotProvider = (ctx: WeekendSlotContext) => Promise<WeekendSlot>;

const PLACEHOLDERS: Record<WeekendSlotKind, Extract<WeekendSlot, { status: 'placeholder' }>> = {
  transport: {
    kind: 'transport',
    status: 'placeholder',
    placeholder: true,
    title: 'Getting there and home',
    body: 'Ride and valet details will appear here once they are set. TODO(Tyler & Sara)',
    owner: 'swarm-G',
  },
  trip: {
    kind: 'trip',
    status: 'placeholder',
    placeholder: true,
    title: 'Your trip',
    body: 'Flights, hotel, and free-time ideas will appear here once travel tools are live. TODO(Tyler & Sara)',
    owner: 'swarm-F',
  },
};

const g = globalThis as unknown as { __weddingWeekendSlots?: Map<WeekendSlotKind, WeekendSlotProvider> };
const providers = (): Map<WeekendSlotKind, WeekendSlotProvider> => (g.__weddingWeekendSlots ??= new Map());

export function registerWeekendSlotProvider(kind: WeekendSlotKind, provider: WeekendSlotProvider): void {
  providers().set(kind, provider);
}

/** Tests only. */
export function clearWeekendSlotProviders(): void {
  providers().clear();
}

export async function resolveWeekendSlots(ctx: WeekendSlotContext): Promise<Record<WeekendSlotKind, WeekendSlot>> {
  const out = {} as Record<WeekendSlotKind, WeekendSlot>;
  for (const kind of WEEKEND_SLOT_KINDS) {
    const provider = providers().get(kind);
    if (!provider) {
      out[kind] = PLACEHOLDERS[kind];
      continue;
    }
    try {
      out[kind] = await provider(ctx);
    } catch {
      // A broken provider must never take Your Weekend down; show an honest state instead.
      out[kind] = { kind, status: 'unavailable', placeholder: false, title: PLACEHOLDERS[kind].title, body: 'This section is temporarily unavailable. Please check back soon.' };
    }
  }
  return out;
}
