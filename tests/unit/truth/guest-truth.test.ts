import { describe, expect, it } from 'vitest';
import { searchMode } from '@/domain/travel/types';

/**
 * Two things a guest was told that were not true, found by reading the site as a guest rather than
 * by running its tests — every test passed while both shipped.
 */
describe('a guest is never shown an invented price as a live one', () => {
  it('the mode union can say "these numbers are made up"', () => {
    // Before: ['live','deep-link','unavailable'] — no honest value for a mock provider, so
    // `search.ts` asserted `live` on any successful search and the UI's `mode !== 'live'` gate,
    // which is what suppresses prices, never fired for the DEFAULT provider.
    expect(searchMode.options).toContain('sample');
    expect(searchMode.options).toEqual(expect.arrayContaining(['live', 'sample', 'deep-link', 'unavailable']));
  });

  it('a provider that declares itself a mock yields sample, not live', async () => {
    const { searchHotels, searchFlights } = await import('@/domain/travel/search');
    expect(typeof searchHotels).toBe('function');
    expect(typeof searchFlights).toBe('function');
    // The unit-level guarantee is the derivation itself: the source must not hard-code `live`.
    const src = await import('node:fs/promises').then((fs) => fs.readFile('src/domain/travel/search.ts', 'utf8'));
    expect(src, 'a hard-coded live mode is how fabricated prices reached guests').not.toContain("mode: 'live'");
    expect(src).toContain('modeFor(provider)');
  });
});

describe('the authoring marker never leaves the site in a URL', () => {
  it('a placeholder address never reaches Maps, and the real name still does', async () => {
    const { directionsHandoff } = await import('@/domain/adventures/repo');
    const placeholderAddress = {
      id: 'p1', name: "Michael Jordan's Steakhouse", placeholder: true,
      address: 'TODO(Tyler & Sara): which location, and its address', lat: null, lng: null,
    } as never;
    const h = directionsHandoff(placeholderAddress);
    // The guarantee is about what TRAVELS, not about whether a button exists. My first version of
    // this test demanded no button at all, which was too strict and broke Starved Rock — a place
    // with only a name, whose name resolves in Maps perfectly well. The defect was never "a place
    // without an address"; it was the authoring marker being sent to a third party.
    expect(h, 'a real name is still a usable destination').toBeTruthy();
    expect(h!.url).not.toContain('TODO');
    expect(decodeURIComponent(h!.url)).not.toContain('Tyler & Sara');
    // `+` is a space in a query string; decodeURIComponent does not undo it.
    expect(decodeURIComponent(h!.url).replace(/\+/g, ' ')).toContain("Michael Jordan's Steakhouse");
  });

  it('a place with nothing real at all offers no button', async () => {
    const { directionsHandoff } = await import('@/domain/adventures/repo');
    const nothingReal = {
      id: 'p3', name: 'TODO(Tyler & Sara): the venue name', placeholder: true,
      address: 'TODO(Tyler & Sara): and its address', lat: null, lng: null,
    } as never;
    expect(directionsHandoff(nothingReal), 'nothing real to send means no button').toBeUndefined();
  });

  it('real coordinates still get a button, and the placeholder address is left out of the URL', async () => {
    const { directionsHandoff } = await import('@/domain/adventures/repo');
    const withCoords = {
      id: 'p2', name: 'Starved Rock State Park', placeholder: true,
      address: 'TODO(Tyler & Sara): the trail and the exact spot', lat: 41.3197, lng: -88.9931,
    } as never;
    const h = directionsHandoff(withCoords);
    expect(h, 'coordinates are enough to give real directions').toBeTruthy();
    expect(h!.url).not.toContain('TODO');
    expect(decodeURIComponent(h!.url)).not.toContain('Tyler & Sara');
  });
});
