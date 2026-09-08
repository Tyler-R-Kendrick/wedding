import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';

/**
 * Typed extension points on Your Weekend: `transport` (rides, valet, parking) and `trip` (flights,
 * lodging, free time). A registered provider fills them from live data; with none registered they
 * fall back to `DEFAULTS` below, which point at the pages that hold the answer. Never invented
 * content, and never a claim about what the site can or cannot do yet.
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
  // No `owner` field. It carried 'swarm-G' / 'swarm-F' — the name of an internal work unit — and
  // `get_my_itinerary` is exposed to `ai` and `webmcp`, so it was shipping build metadata into
  // assistant transcripts. Nothing outside this file ever read it.
  | { kind: WeekendSlotKind; status: 'placeholder'; placeholder: true; title: string; body: string }
  | { kind: WeekendSlotKind; status: 'ready'; placeholder: false; title: string; items: WeekendSlotItem[]; retrievedAt?: string }
  | { kind: WeekendSlotKind; status: 'unavailable'; placeholder: false; title: string; body: string };

export interface WeekendSlotContext {
  principal: Principal;
  guestId: string;
  db: Db;
  now: Date;
}

export type WeekendSlotProvider = (ctx: WeekendSlotContext) => Promise<WeekendSlot>;

/**
 * What a slot says when no provider is registered — which, on the shipped site, is always.
 *
 * These read "Ride and valet details will appear here once they are set" and "Flights, hotel, and
 * free-time ideas will appear here once travel tools are live". Both were true when they were
 * written, at level 03. Levels 08 and 09 built `/transportation` and `/trip`, and they sit in the
 * same nav as Your Weekend — so a guest read that the travel tools were not live on a page one tap
 * from the live travel tools. `registerWeekendSlotProvider` is called from
 * `tests/integration/weekend.test.ts` and nowhere else, so nothing was ever going to replace them.
 *
 * They point at the pages that hold the answer instead. Not a placeholder: nothing here is
 * unwritten, it simply lives one page over, and labelling it "Sara + Tyler are still writing this"
 * was the second false thing this card said.
 *
 * `owner: 'swarm-G'` went with them, and off the type entirely — see `WeekendSlot` above.
 */
const DEFAULTS: Record<WeekendSlotKind, WeekendSlot> = {
  transport: {
    kind: 'transport',
    status: 'ready',
    placeholder: false,
    title: 'Getting there and home',
    items: [{ label: 'Rides, valet and parking', detail: 'on the Transportation page', href: '/transportation' }],
  },
  trip: {
    kind: 'trip',
    status: 'ready',
    placeholder: false,
    title: 'Your trip',
    items: [{ label: 'Flights, where you are staying, and the free time in between', detail: 'on your Trip page', href: '/trip' }],
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
      out[kind] = DEFAULTS[kind];
      continue;
    }
    try {
      out[kind] = await provider(ctx);
    } catch {
      // A broken provider must never take Your Weekend down; show an honest state instead.
      out[kind] = { kind, status: 'unavailable', placeholder: false, title: DEFAULTS[kind].title, body: 'This section is temporarily unavailable. Please check back soon.' };
    }
  }
  return out;
}
