import { okConfig, upHealth } from '../base';
import { PLACE_DIETS, type FoundPlace, type PlaceDiet, type PlaceKind, type PlaceSearchProvider, type PlaceSearchRequest } from './types';

/**
 * OpenStreetMap's own search (Nominatim): free, no account and no key. Its usage policy is kept
 * here: at most one request a second (a queue), an application named in the User-Agent, results
 * kept (a day) rather than asked for again, and "© OpenStreetMap contributors" beside what is shown.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'wedding-site-trip-planner/1.0';
const PHRASE: Record<PlaceKind, string> = { restaurant: 'restaurant', cafe: 'cafe', fast_food: 'fast food', bar: 'bar', museum: 'museum', attraction: 'attraction', park: 'park', playground: 'playground' };
/** About 1.3 km each way from the hotel: a walk. A diet looked for by name reaches further, since so few are tagged. */
const NEAR = { lat: 0.012, lng: 0.016 };
const WIDER = { lat: 0.03, lng: 0.04 };
const DAY_MS = 24 * 60 * 60 * 1000;
const GAP_MS = 1100;
const TIMEOUT_MS = 4000;

type Row = { osm_type?: string; osm_id?: number; lat?: string; lon?: string; category?: string; type?: string; name?: string; address?: Record<string, string>; extratags?: Record<string, string> | null };
const DIET_TAG: Record<string, PlaceDiet> = { vegetarian: 'vegetarian', vegan: 'vegan', gluten_free: 'gluten-free', halal: 'halal', kosher: 'kosher' };
const KIND_OF: Record<string, PlaceKind> = { restaurant: 'restaurant', cafe: 'cafe', fast_food: 'fast_food', bar: 'bar', pub: 'bar', museum: 'museum', attraction: 'attraction', park: 'park', playground: 'playground' };

/** One of Nominatim's rows as the planner reads a place. `said`: diets the search itself was for, when the name says so. */
export function fromNominatim(row: Row, kind: PlaceKind, said: readonly PlaceDiet[] = []): FoundPlace | null {
  const name = String(row.name ?? '').trim();
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!name || !row.osm_type || !row.osm_id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = row.extratags ?? {};
  const cuisine = String(tags.cuisine ?? '').toLowerCase().split(';').map((s) => s.trim()).filter(Boolean);
  const diet = new Set<PlaceDiet>(said);
  for (const [k, v] of Object.entries(tags)) {
    const d = k.startsWith('diet:') ? DIET_TAG[k.slice(5)] : undefined;
    if (d && (v === 'yes' || v === 'only')) diet.add(d);
  }
  for (const c of cuisine) if (c === 'vegan' || c === 'vegetarian') diet.add(c);
  if (diet.has('vegan')) diet.add('vegetarian');
  const a = row.address ?? {};
  const address = [[a.house_number, a.road].filter(Boolean).join(' '), a.city].filter(Boolean).join(', ');
  const website = tags.website ?? tags['contact:website'];
  return {
    id: `osm:${row.osm_type}/${row.osm_id}`,
    name: name.slice(0, 120),
    kind,
    cuisine,
    diet: PLACE_DIETS.filter((d) => diet.has(d)),
    ...(address ? { address } : {}),
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    ...(website && /^https?:\/\//i.test(website) ? { website: website.slice(0, 300) } : {}),
    ...(tags.opening_hours ? { hours: tags.opening_hours.slice(0, 200) } : {}),
  };
}

export class NominatimPlaceSearch implements PlaceSearchProvider {
  readonly kind = 'place-search' as const;
  readonly name = 'nominatim';
  readonly mode = 'live' as const;
  readonly capabilities = { near: true };
  readonly attribution = { text: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' };
  private readonly kept = new Map<string, { at: number; places: FoundPlace[] }>();
  private readonly flying = new Map<string, Promise<FoundPlace[]>>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private readonly opts: { fetch?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void> } = {}) {}

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth('keyless');
  }

  async near(req: PlaceSearchRequest): Promise<FoundPlace[]> {
    const kinds = [...new Set(req.kinds)].filter((k) => k in PHRASE).slice(0, 4);
    const lists = await Promise.all([
      ...kinds.map((k) => this.ask(`kind:${k}`, `[${PHRASE[k]}]`, req.at, NEAR, (row) => fromNominatim(row, k))),
      // A diet by name, for the places whose name says it ("… Vegan Taqueria"): only when a meal is looked for.
      ...(kinds.some((k) => k === 'restaurant' || k === 'fast_food' || k === 'cafe')
        ? [...new Set(req.diet ?? [])].slice(0, 2).map((d) =>
            this.ask(`diet:${d}`, `${d.replace('-', ' ')} restaurant`, req.at, WIDER, (row) => {
              const kind = row.category === 'amenity' ? KIND_OF[String(row.type)] : undefined;
              const named = new RegExp(d.replace('-', '[- ]?'), 'i').test(String(row.name ?? ''));
              return kind && named ? fromNominatim(row, kind, [d]) : null;
            }),
          )
        : []),
    ]);
    const seen = new Set<string>();
    return lists.flat().filter((p) => !seen.has(p.id) && seen.add(p.id));
  }

  /** One search, kept for a day; searches that are not kept wait their turn, a second apart. A failure is nothing found, and is not kept. */
  private ask(key: string, q: string, at: { lat: number; lng: number }, box: { lat: number; lng: number }, read: (row: Row) => FoundPlace | null): Promise<FoundPlace[]> {
    const now = this.opts.now ?? Date.now;
    const id = `${key}@${at.lat.toFixed(3)},${at.lng.toFixed(3)}`;
    const hit = this.kept.get(id);
    if (hit && now() - hit.at < DAY_MS) return Promise.resolve(hit.places);
    const flying = this.flying.get(id);
    if (flying) return flying;
    const run = this.queue.then(async () => {
      const wait = this.opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const since = now() - this.last;
      if (since < GAP_MS) await wait(GAP_MS - since);
      this.last = now();
      const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: 'jsonv2', limit: '40', bounded: '1', viewbox: `${at.lng - box.lng},${at.lat + box.lat},${at.lng + box.lng},${at.lat - box.lat}`, extratags: '1', addressdetails: '1' })}`;
      try {
        const res = await (this.opts.fetch ?? fetch)(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return [];
        const rows = (await res.json()) as unknown;
        const places = (Array.isArray(rows) ? (rows as Row[]) : []).map(read).filter((p): p is FoundPlace => !!p);
        this.kept.set(id, { at: now(), places });
        return places;
      } catch {
        return [];
      }
    });
    this.queue = run.catch(() => undefined);
    this.flying.set(id, run);
    void run.finally(() => this.flying.delete(id));
    return run;
  }
}
