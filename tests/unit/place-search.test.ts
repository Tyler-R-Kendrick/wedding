import { describe, expect, it, vi } from 'vitest';
import { createPlaceSearchProvider, fromNominatim, MockPlaceSearch, NominatimPlaceSearch, NOMINATIM_URL, PLACE_SEARCH_FIXTURE } from '@/providers/place-search';

/**
 * The search of the neighbourhood (OpenStreetMap's Nominatim): what it sends, how often, and how a
 * row is read. Nothing here reaches the network: the adapter takes its fetch and its clock.
 */
const HOTEL = { lat: 41.8815, lng: -87.6246 };
const row = (over: Record<string, unknown> = {}) => ({
  osm_type: 'node',
  osm_id: 42,
  lat: '41.8898589',
  lon: '-87.6302709',
  category: 'amenity',
  type: 'restaurant',
  name: 'Il Porcellino',
  address: { house_number: '59', road: 'West Hubbard Street', city: 'Chicago' },
  extratags: { cuisine: 'pasta;italian', website: 'http://ilporcellinochicago.com/', opening_hours: 'Mo-We 16:00-23:00', 'diet:vegetarian': 'yes', 'diet:kosher': 'no', phone: '+1-312-000-0000' },
  ...over,
});

describe('reading a row', () => {
  it('keeps what the planner shows, and nothing else', () => {
    expect(fromNominatim(row(), 'restaurant')).toEqual({
      id: 'osm:node/42',
      name: 'Il Porcellino',
      kind: 'restaurant',
      cuisine: ['pasta', 'italian'],
      diet: ['vegetarian'],
      address: '59 West Hubbard Street, Chicago',
      lat: 41.889859,
      lng: -87.630271,
      website: 'http://ilporcellinochicago.com/',
      hours: 'Mo-We 16:00-23:00',
    });
  });

  it('a vegan place is vegetarian too; an unnamed or unplaced row is nothing; a link that is not the web is dropped', () => {
    expect(fromNominatim(row({ extratags: { cuisine: 'vegan' } }), 'restaurant')?.diet).toEqual(['vegetarian', 'vegan']);
    expect(fromNominatim(row({ name: '  ' }), 'restaurant')).toBeNull();
    expect(fromNominatim(row({ lat: 'x' }), 'restaurant')).toBeNull();
    expect(fromNominatim(row({ extratags: { website: 'javascript:alert(1)' } }), 'cafe')?.website).toBeUndefined();
    // A diet the search itself was for, when the caller says the name carries it.
    expect(fromNominatim(row({ extratags: null }), 'restaurant', ['vegan'])?.diet).toEqual(['vegetarian', 'vegan']);
  });
});

describe('asking OpenStreetMap', () => {
  const setup = (reply: (url: string) => unknown = () => [row()]) => {
    let now = 1_000_000;
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      headers.push(init?.headers as Record<string, string>);
      const body = reply(String(url));
      return { ok: body !== null, json: async () => body } as Response;
    });
    const waits: number[] = [];
    const search = new NominatimPlaceSearch({
      fetch: fetchFn as unknown as typeof fetch,
      now: () => now,
      wait: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });
    return { search, urls, headers, waits, fetchFn, tick: (ms: number) => (now += ms) };
  };

  it('sends a kind of place and the hotel’s neighbourhood, named as an application, and nothing about the guest', async () => {
    const { search, urls, headers } = setup();
    const found = await search.near({ kinds: ['restaurant'], at: HOTEL });
    expect(found.map((p) => p.name)).toEqual(['Il Porcellino']);
    const url = new URL(urls[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '[restaurant]', format: 'jsonv2', limit: '40', bounded: '1', viewbox: expect.stringMatching(/^-87\.64\d*,41\.89\d*,-87\.60\d*,41\.86\d*$/), extratags: '1', addressdetails: '1' });
    expect(headers[0]!['User-Agent']).toMatch(/^wedding-site-trip-planner\//);
  });

  it('asks at most once a second, keeps an answer for a day, and never asks twice for the same thing at once', async () => {
    const { search, waits, fetchFn, tick } = setup();
    const both = await Promise.all([search.near({ kinds: ['restaurant', 'cafe', 'bar'], at: HOTEL }), search.near({ kinds: ['restaurant'], at: HOTEL })]);
    expect(both[0].length).toBe(1);
    // Three kinds, three requests (the second caller shares the first one's), each a second after the last.
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waits.length).toBe(2);
    expect(waits.every((ms) => ms >= 1000 && ms <= 1100)).toBe(true);
    await search.near({ kinds: ['restaurant', 'cafe'], at: HOTEL });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    tick(25 * 60 * 60 * 1000);
    await search.near({ kinds: ['cafe'], at: HOTEL });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('a failure is nothing found, and is asked for again next time', async () => {
    let fail = true;
    const { search, fetchFn } = setup(() => (fail ? null : [row()]));
    expect(await search.near({ kinds: ['museum'], at: HOTEL })).toEqual([]);
    fail = false;
    expect((await search.near({ kinds: ['museum'], at: HOTEL })).length).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('looks for a diet by name as well, keeping only places whose name says it', async () => {
    const { search, urls } = setup((url) =>
      new URL(url).searchParams.get('q') === 'vegan restaurant'
        ? [row({ osm_id: 7, name: "Penelope's Vegan Taqueria", extratags: { cuisine: 'mexican' } }), row({ osm_id: 8, name: 'Steak Place', extratags: null })]
        : [row()],
    );
    const found = await search.near({ kinds: ['restaurant'], at: HOTEL, diet: ['vegan'] });
    expect(urls.map((u) => new URL(u).searchParams.get('q'))).toEqual(['[restaurant]', 'vegan restaurant']);
    expect(found.map((p) => [p.name, p.diet])).toEqual([
      ['Il Porcellino', ['vegetarian']],
      ["Penelope's Vegan Taqueria", ['vegetarian', 'vegan']],
    ]);
    // A diet is not looked for by name where no meal is.
    const parks = setup();
    await parks.search.near({ kinds: ['park'], at: HOTEL, diet: ['vegan'] });
    expect(parks.urls).toHaveLength(1);
  });
});

describe('which search is used', () => {
  it('tests read the recorded sample; everywhere else OpenStreetMap, with nothing to configure', async () => {
    expect(createPlaceSearchProvider({ NODE_ENV: 'test', FORCE_MOCK_PROVIDERS: false }).name).toBe('mock');
    expect(createPlaceSearchProvider({ NODE_ENV: 'production', FORCE_MOCK_PROVIDERS: true }).name).toBe('mock');
    const live = createPlaceSearchProvider({ NODE_ENV: 'production', FORCE_MOCK_PROVIDERS: false });
    expect([live.name, live.mode, live.validateConfig().ok]).toEqual(['nominatim', 'live', true]);
    expect(live.attribution).toEqual({ text: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' });
    const mock = new MockPlaceSearch();
    const cafes = await mock.near({ kinds: ['cafe'], at: HOTEL });
    expect(cafes.length).toBeGreaterThan(10);
    expect(cafes.every((p) => p.kind === 'cafe' && p.name)).toBe(true);
    expect(PLACE_SEARCH_FIXTURE.length).toBeGreaterThan(100);
  });
});
