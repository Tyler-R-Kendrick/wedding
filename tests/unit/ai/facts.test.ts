import { describe, expect, it } from 'vitest';
import { factsFromOutcome, HOME_ROUTE, objectLines, textLines, UNDECIDED } from '@/ai/facts';
import { INTERNAL_ROUTES } from '@/capabilities/routes';
import type { AnyCapability, CapabilityOutcome } from '@/contracts/capability';
import type { ContentSourceId } from '@/contracts/ids';

const descriptor = (over: Partial<Pick<AnyCapability, 'name' | 'title' | 'kind' | 'annotations'>> = {}) => ({
  name: 'get_faq',
  title: 'Ask Us (FAQ)',
  kind: 'read' as const,
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  ...over,
});

const outcome = <T,>(data: T, over: Partial<CapabilityOutcome<T>> = {}): CapabilityOutcome<T> => ({ data, sources: [], ...over });

const markers = () => {
  let n = 0;
  return { next: () => `S${++n}` };
};

describe('capability output as evidence', () => {
  it('drops the placeholder hint and says the fact is undecided instead', () => {
    expect(textLines('', 'The ceremony is at TODO(Tyler & Sara) o’clock.', true)).toEqual([`This is ${UNDECIDED}.`]);
    expect(textLines('Answer: ', 'Kids are welcome. Details TODO(Tyler & Sara).')).toEqual(['Answer: Kids are welcome.', `Answer: other details ${UNDECIDED}.`]);
  });

  it('never repeats the caller’s own question back as a fact', () => {
    expect(objectLines({ query: 'what is the weather in Paris', answer: { text: 'It rains sometimes.', placeholder: false } })).toEqual(['It rains sometimes.']);
  });

  it('uses identity fields as the block title, not as quotable lines, and drops bare booleans', () => {
    expect(objectLines({ question: 'Can we bring our kids?', answer: { text: 'Yes.', placeholder: false }, kidFriendly: true })).toEqual(['Yes.']);
  });

  it('builds one citable block per provenance-bearing record', () => {
    const data = {
      entries: [
        { id: '1', slug: 'kids', question: 'Can we bring our kids?', answer: { text: 'Yes, all ages are welcome.', placeholder: false }, provenance: { sourceId: 'faq', verifiedAt: '2027-06-01T00:00:00.000Z', url: '/ask-us#kids', trustClass: 'TRUSTED_WEDDING' } },
        { id: '2', slug: 'dress', question: 'What should I wear?', answer: { text: 'TODO(Tyler & Sara) decide the dress code.', placeholder: true }, provenance: { sourceId: 'faq', verifiedAt: '2027-06-01T00:00:00.000Z', url: '/ask-us#dress', trustClass: 'TRUSTED_WEDDING' } },
      ],
    };
    const blocks = factsFromOutcome(descriptor(), outcome(data), markers());
    expect(blocks.map((b) => b.citation.title)).toEqual(['Can we bring our kids?', 'What should I wear?']);
    expect(blocks[0]!.lines).toEqual(['Yes, all ages are welcome.']);
    expect(blocks[1]!.lines.join(' ')).toContain(UNDECIDED);
    expect(blocks.every((b) => b.citation.url?.startsWith('/ask-us'))).toBe(true);
  });

  it('cites a leftovers block to the capability and its page, never to an unrelated record', () => {
    const data = { note: 'Valet is on Madison Street.' };
    const blocks = factsFromOutcome(descriptor({ name: 'get_venue_facts', title: 'Explore the CAA' }), outcome(data, { sources: [{ sourceId: 'other' as ContentSourceId, title: 'Built in 1893', url: '/explore-caa#history' }] }), markers());
    expect(blocks[0]!.citation.title).toBe('Explore the CAA');
    expect(blocks[0]!.citation.url).toBe('/explore-caa');
  });

  it('turns every search hit into its own block with its own public URL', () => {
    const data = {
      query: 'valet',
      mode: 'static',
      results: [
        { id: 'r1', kind: 'operational', title: 'Valet entrance', snippet: 'x', content: 'Valet is on Madison Street. Rates are on the hotel FAQ.', route: '/explore-caa#getting-here', url: 'https://www.chicagoathletichotel.com/about/faq/', sourceId: 'caa-web', verifiedAt: '2027-06-01T00:00:00.000Z', trustClass: 'EXTERNAL_DATA', caveat: 'Last checked 2027-06-01.', recordRef: { type: 'operational_fields', id: 'o1' } },
      ],
    };
    const blocks = factsFromOutcome(descriptor({ name: 'search_wedding_information', title: 'Search' }), outcome(data), markers());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.citation.url).toBe('https://www.chicagoathletichotel.com/about/faq/');
    expect(blocks[0]!.trust).toBe('EXTERNAL_DATA');
    expect(blocks[0]!.lines).toEqual(['Valet is on Madison Street.', 'Rates are on the hotel FAQ.', 'Last checked 2027-06-01.']);
    expect(blocks[0]!.lines.join(' ')).not.toContain('valet entrance');
  });

  it('stamps live data with the moment it was retrieved', () => {
    const blocks = factsFromOutcome(descriptor({ name: 'eval_flight_status', title: 'Flight status', kind: 'external', annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: true } }), outcome({ status: 'On time' }, { retrievedAt: '2027-07-16T12:00:00.000Z' }), markers());
    expect(blocks[0]!.trust).toBe('EXTERNAL_DATA');
    expect(blocks[0]!.lines[0]).toMatch(/^As of 2027-07-16 12:00 UTC \(live data\): /);
  });
});

describe('authoring markers never reach a guest', () => {
  // Every branch of the flattener has to obey ADR-0003 rule 6, not just the ones that happened to.
  // A `string[]` was rendered by a bare join with no placeholder filter, which is how
  // "TODO(Tyler & Sara): ride benefit amount, area and validity (backlog P-05)" reached a real
  // concierge answer for a signed-in guest asking about their ride benefit.
  it('drops placeholder members of a string list and says something was dropped', () => {
    const lines = objectLines({ notes: ['Eligible adult guests will find a ride benefit here once it is ready.', 'TODO(Tyler & Sara): ride benefit amount, area and validity (backlog P-05)'] });
    expect(lines.join(' ')).not.toContain('TODO(');
    expect(lines.join(' ')).not.toContain('backlog P-05');
    expect(lines.join(' ')).toContain('ride benefit here once it is ready');
    expect(lines.join(' ')).toContain(UNDECIDED);
  });

  it('renders a list that is nothing but placeholders as undecided, with no marker', () => {
    const lines = objectLines({ notes: ['TODO(Tyler & Sara): pick a shuttle window'] });
    expect(lines.join(' ')).not.toContain('TODO(');
    expect(lines.join(' ')).toContain(UNDECIDED);
  });

  it('keeps an ordinary string list exactly as it was', () => {
    expect(objectLines({ stops: ['Cindy’s', 'Game Room'] })).toEqual(['Stops: Cindy’s; Game Room.']);
  });

  it('drops a search caveat that carries a marker', () => {
    const outcome: CapabilityOutcome<unknown> = {
      data: { results: [{ title: 'Valet', content: 'Valet is at 71 E Madison.', caveat: 'TODO(Tyler & Sara): confirm overnight valet rate', url: '/explore-caa', verifiedAt: '2026-01-01T00:00:00.000Z', sourceId: 's1' }] },
      sources: [],
    };
    const blocks = factsFromOutcome(descriptor({ name: 'search_wedding_information', title: 'Search' }), outcome, markers());
    expect(blocks.flatMap((b) => b.lines).join(' ')).not.toContain('TODO(');
  });
});

describe('citations point at pages that exist', () => {
  // A citation is an invitation to go and check. A route that 404s, or that is not the page holding
  // the fact, is worse than no citation at all — and the table below is the only thing standing
  // between a capability and `/ask-us`, the page the guest is already reading.
  it('every authored citation route is a real internal route', () => {
    for (const [capability, route] of Object.entries(HOME_ROUTE)) {
      expect((INTERNAL_ROUTES as readonly string[]).includes(route.split('#')[0]!), `${capability} -> ${route}`).toBe(true);
    }
  });

  it('falls back to a single unambiguous source before falling back to Ask Us', () => {
    const unmapped = descriptor({ name: 'not_in_the_table', title: 'Something new' });
    const one = factsFromOutcome(unmapped, outcome({ note: 'A fact.' }, { sources: [{ sourceId: 's' as ContentSourceId, title: 'The chart', url: '/your-weekend' }] }), markers());
    expect(one[0]!.citation.url).toBe('/your-weekend');
    expect(one[0]!.citation.title).toBe('Something new');
    const many = factsFromOutcome(unmapped, outcome({ note: 'A fact.' }, { sources: [{ sourceId: 'a' as ContentSourceId, title: 'A', url: '/travel' }, { sourceId: 'b' as ContentSourceId, title: 'B', url: '/gifts' }] }), markers());
    expect(many[0]!.citation.url).toBe('/ask-us');
    const none = factsFromOutcome(unmapped, outcome({ note: 'A fact.' }, { sources: [] }), markers());
    expect(none[0]!.citation.url).toBe('/ask-us');
  });
});

