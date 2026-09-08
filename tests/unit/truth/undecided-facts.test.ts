import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planRoute, PROTECTED_FACT_WORDS, toolsFor, type RouterTool } from '@/ai/router';
import { BUILTIN_CAPABILITIES } from '@/capabilities';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import { placeholderFacts, placeholderHint, withoutPlaceholderMarker } from '@/components/provenance/Placeholder';
import { FEATURE_FLAGS, type FlagValues } from '@/contracts/flags';
import type { Principal } from '@/contracts/principal';
import { objectLines } from '@/ai/facts';
import { GIFTS_COPY, giftsStatement } from '@/domain/gifts/copy';
import { splitPlaceholderText, withoutPlaceholders } from '@/domain/content/text';

/**
 * What the site says about a fact NOBODY HAS DECIDED YET.
 *
 * Three defects a guest found by asking ordinary questions, each of which the suite was green over:
 *
 *  1. A settled fact glued to a TODO was discarded whole, so the corpus lost how to RSVP and that
 *     the ceremony is indoors — and the concierge then denied knowing either.
 *  2. The same string handed to a placeholder block read "Sara + Tyler are still writing this: The
 *     ceremony and reception are indoors at the hotel. any outdoor plans for the weekend." — a
 *     decided fact labelled undecided, then a lowercase run-on.
 *  3. "I have a nut allergy — what food will there be?" missed the menu gate entirely, so no gate
 *     ran and the answer was assembled from the hotel's restaurant pages.
 */

const flags = { ...FEATURE_FLAGS } as FlagValues;
const anonymous: Principal = { kind: 'anonymous' };
const registry = new CapabilityRegistryImpl();
registry.registerAll(BUILTIN_CAPABILITIES);
const plan = (question: string) => {
  const available: RouterTool[] = toolsFor(anonymous, flags, registry);
  return planRoute(question, available, registry.list({ exposure: 'ai', flags }), 4);
};

const FAQ: { slug: string; answer: string }[] = JSON.parse(readFileSync('src/content/seed/faq.json', 'utf8'));
const answerFor = (slug: string) => FAQ.find((e) => e.slug === slug)!.answer;

describe('a decided fact beside an undecided one', () => {
  it('keeps the decided sentences out of the corpus scrubber and drops only the hint', () => {
    // The exact five seeded answers that mix the two. Each names something a guest acts on.
    const kept = withoutPlaceholders([answerFor('rsvp'), answerFor('weather'), answerFor('accessibility'), answerFor('plus-ones'), answerFor('photos')]);
    expect(kept).toHaveLength(5);
    const corpus = kept.join(' ');
    expect(corpus).toContain('one-time code sent to your email');
    expect(corpus).toContain('The ceremony and reception are indoors at the hotel.');
    expect(corpus).toContain('accessible rooms');
    expect(corpus).toContain('Your invitation will say who it covers.');
    expect(corpus).toContain('Two professional photographers');
    // and none of the hints, in any form
    expect(corpus).not.toContain('TODO');
    expect(corpus).not.toContain('RSVP deadline');
    expect(corpus).not.toContain('outdoor plans');
  });

  it('drops a record only when every sentence in it is a hint', () => {
    expect(withoutPlaceholders([answerFor('dress-code')])).toEqual([]);
    expect(withoutPlaceholders([answerFor('contact')])).toEqual([]);
    expect(withoutPlaceholders([null, undefined, '   '])).toEqual([]);
  });

  it('splits a mixed string per sentence, not per record', () => {
    const { settled, hints } = splitPlaceholderText(answerFor('weather'));
    expect(settled).toEqual(['The ceremony and reception are indoors at the hotel.']);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('outdoor plans');
  });
});

describe('the placeholder block', () => {
  const mixed = answerFor('weather');

  it('labels only the hint, and shows the decided sentence as a fact beside it', () => {
    expect(placeholderHint(mixed)).toBe('any outdoor plans for the weekend.');
    expect(placeholderHint(mixed)).not.toContain('indoors at the hotel');
    expect(placeholderFacts(mixed)).toBe('The ceremony and reception are indoors at the hotel.');
  });

  it('leaves a wholly-undecided block exactly as it was', () => {
    expect(placeholderHint(answerFor('contact')).toLowerCase()).toContain('best way for guests to reach you');
    expect(placeholderFacts(answerFor('contact'))).toBe('');
  });

  it('flattens a mixed string for the callers with no block to render into, without the run-on', () => {
    const flat = withoutPlaceholderMarker(mixed);
    expect(flat).toBe('The ceremony and reception are indoors at the hotel. Any outdoor plans for the weekend.');
    expect(flat).not.toContain('TODO');
    expect(flat).not.toMatch(/\.\s+[a-z]/);
  });

  it('leaves a stand-alone hint in the case it was written in', () => {
    // These read after a label — "Sara + Tyler are still writing this: a restaurant we love" — and a
    // reservation card prints one as its <h3>. Capitalising is only for the run-on above.
    expect(withoutPlaceholderMarker('TODO(Tyler & Sara): a restaurant we love')).toBe('a restaurant we love');
  });
});

describe('the menu gate', () => {
  // A dietary need is how food gets asked about. Every one of these is the wedding meal.
  it.each([
    'I have a nut allergy — what food will there be?',
    'What is being served for dinner?',
    'What are the dietary options?',
    'Can you accommodate allergies?',
    'Is the dinner nut-free?',
    'Will there be a meal or just drinks?',
    'Is the food kosher?',
    'What is on the menu?',
  ])('gates %j as the wedding menu', (question) => {
    expect(plan(question).protectedFact).toBe('menu');
  });

  // A named hotel outlet has a public, dated answer; refusing it with "the menu is not decided
  // yet" would be true about the wedding and not what was asked.
  it.each(["Is Cindy's vegetarian friendly?", 'What food does Shake Shack serve?'])('does not gate %j', (question) => {
    expect(plan(question).protectedFact).toBeUndefined();
  });

  it('lets the honest refusal through the on-topic filter, as the other four facts already do', () => {
    const honest = 'This is not yet decided.';
    for (const fact of ['room', 'time', 'dress', 'menu', 'music'] as const) {
      expect(PROTECTED_FACT_WORDS[fact].test(honest), fact).toBe(true);
    }
    // and still refuses a sentence that is about the hotel's restaurants instead
    expect(PROTECTED_FACT_WORDS.menu.test("Its hours are on the hotel's official page.")).toBe(false);
  });
});


describe('the gifts page, with no registry chosen', () => {
  it('never states that a wishlist is kept with a provider', () => {
    const nothing = giftsStatement({ registry: 0, adventures: 0 });
    expect(nothing).not.toContain('kept with a registry provider');
    expect(nothing).toContain('have not chosen where to keep either list yet');
    // and says it plainly once a provider does exist
    expect(giftsStatement({ registry: 1, adventures: 0 })).toContain('kept with a registry provider');
    expect(giftsStatement({ registry: 1, adventures: 0 })).toContain('no way to help with the next adventures yet');
  });

  it('keeps the page\'s own furniture out of an answer, field paths and all', () => {
    const lines = objectLines({ copy: GIFTS_COPY, links: [], statement: giftsStatement({ registry: 0, adventures: 0 }) }).join('\n');
    // The defect, verbatim from a guest's answer: an internal field path, and a registry asserted
    // to exist, both from the page copy the AI renderer flattened.
    expect(lines).not.toContain('Copy ›');
    expect(lines).not.toContain('›');
    expect(lines).not.toContain('kept with a registry provider');
    expect(lines).not.toContain('Thank you. Truly.');
    // what it says instead
    expect(lines).toContain('have not chosen where to keep either list yet');
    expect(lines).toContain('never see payment details');
  });
});
