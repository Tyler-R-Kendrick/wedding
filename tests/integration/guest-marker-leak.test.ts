import { beforeAll, describe, expect, it } from 'vitest';
import { getMyItinerary, getMyRsvp, listMyEvents } from '@/capabilities/rsvp';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import { fixturePrincipal } from '@/db/seed/fixtures';
import { expectOk, run, seedSwarmE } from './helpers/swarm-e';

/**
 * `TODO(Tyler & Sara)` is how a content record says "not a fact yet". It is an authoring detail:
 * the typed `placeholder: true` flag is what a caller reads, and the marker itself must not leave
 * the server on a guest surface.
 *
 * It is asserted over the WHOLE serialized payload rather than the one field it was found in
 * (`event.description`, which reached the RSC payload of a page that does not even render it), so a
 * future field carrying a marker fails here instead of on the page. These capabilities are exposed
 * to `ai` and `webmcp`, so a leak here also reaches assistant transcripts.
 */
describe('the authoring marker never leaves the server on a guest surface', () => {
  beforeAll(async () => {
    await seedSwarmE();
  });

  const A1 = fixturePrincipal('A1');

  // Each case yields the serialized payload: the three capabilities have different output types,
  // so a tuple of the calls themselves would unify to whichever came first.
  const cases: Array<[string, () => Promise<string>]> = [
    ['get_my_rsvp', async () => JSON.stringify(expectOk(await run(getMyRsvp, A1, {})).data)],
    ['list_my_events', async () => JSON.stringify(expectOk(await run(listMyEvents, A1, {})).data)],
    ['get_my_itinerary', async () => JSON.stringify(expectOk(await run(getMyItinerary, A1, {})).data)],
  ];

  it.each(cases)('%s carries no marker anywhere in its payload', async (_name, payload) => {
    const json = await payload();
    expect(json).not.toContain(PLACEHOLDER_MARKER);
    expect(json).not.toContain('TODO(');
  });
});
