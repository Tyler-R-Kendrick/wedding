import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecommendationCardView } from '@/app/(public)/_recipes/kit';
import type { ProvenanceViewData, RecommendationCard } from '@/domain/content/views';
import { content as botanical } from '@/themes/botanical-deco/kit/content';

/*
 * A recommendation's facts on its page, in both kits: a row for each fact the record holds, in
 * plain words, and no row for one it does not.
 */
/** A clock time holds a non-breaking space, so "pm" is never alone on a line. */
const NB = '\u00a0';
const provenance: ProvenanceViewData = {
  sourceId: 'src', sourceType: 'authored', sourceTitle: 'Sara and Tyler', url: '/guests/things-to-do/cindys', verifiedAt: '2026-09-04T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING',
  contentVersion: 1, editedBy: 'seed', freshness: 'fresh', policy: 'durable', external: false,
};
const card = (over: Partial<RecommendationCard> = {}): RecommendationCard => ({
  id: 'r', slug: 'cindys', href: '/guests/things-to-do/cindys', title: 'Cindy’s Rooftop', category: 'food-drink', interests: ['food'], what: { text: 'Dinner over the park.', placeholder: false },
  durationMinutes: 90, kidFriendly: null, draft: false, placeholder: false, handoffs: {}, provenance, ...over,
});
const facts: RecommendationCard['facts'] = {
  priceLevel: 3, hours: 'Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off', hoursNote: 'Shorter hours in winter.', reservations: 'recommended', diets: ['vegetarian', 'vegan'],
  stepFree: false, setting: 'both', minAge: 21,
};
const EXPECTED: [string, string[]][] = [
  ['Price', ['Pricey, $40 to $100 each']],
  ['Cost', ['About $60 each with a drink.']],
  ['Hours', [`Monday to Thursday: 7${NB}am to 6${NB}pm`, `Friday and Saturday: 7${NB}am to 8${NB}pm`, 'Sunday: Closed', 'Shorter hours in winter.', 'Hours change, so check with the place before you go.']],
  ['Booking', ['Booking is a good idea']],
  ['Diet options', ['Vegetarian and vegan options on the menu']],
  ['Accessibility', ['Lift from the lobby.']],
  ['Way in', ['No step-free way in']],
  ['Setting', ['Indoors and outdoors']],
  ['With kids', ['Better without']],
  ['Ages', ['21 and over']],
];
const FACT_LABELS = ['Price', 'Hours', 'Booking', 'Diet options', 'Way in', 'Setting', 'Ages'];
const full = card({ facts, kidFriendly: false, cost: { text: 'About $60 each with a drink.', placeholder: false }, accessibility: { text: 'Lift from the lobby.', placeholder: false } });

/** Each term of a description list with the lines of its description, whatever element keeps them apart. */
function rows(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll('dt')].map((dt) => {
    const dd = dt.nextElementSibling as HTMLElement;
    const spans = [...dd.children].filter((c) => c.tagName === 'SPAN');
    const texts = [...dd.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '');
    const lines = spans.length > 1 ? spans.map((s) => s.textContent ?? '') : dd.querySelector('br') ? texts : [dd.textContent ?? ''];
    return [dt.textContent ?? '', lines];
  });
}

describe.each([
  ['Botanical Deco', (c: RecommendationCard) => <botanical.RecommendationCard card={c} headingLevel={2} />],
  ['the fallback kit', (c: RecommendationCard) => <RecommendationCardView card={c} headingLevel={2} />],
])('a recommendation’s facts in %s', (_kit, view) => {
  it('gives each fact its own row, beside the cost and access notes it belongs with', () => {
    const { container } = render(view(full));
    const shown = rows(container).filter(([label]) => EXPECTED.some(([l]) => l === label));
    expect(shown).toEqual(EXPECTED);
  });

  it('shows no row for a fact the record does not hold', () => {
    const none = render(view(card()));
    for (const label of FACT_LABELS) expect(rows(none.container).map(([l]) => l), label).not.toContain(label);
    none.unmount();

    const some = render(view(card({ facts: { stepFree: true, reservations: 'walk-in' } })));
    expect(rows(some.container).filter(([label]) => FACT_LABELS.includes(label))).toEqual([
      ['Booking', ['Just walk in']],
      ['Way in', ['Step-free']],
    ]);
  });

  it('does not say "step-free" under the place’s own access notes, which already say how to get in', () => {
    const access = { text: 'Lift from the lobby to the 13th floor.', placeholder: false };
    const labels = (c: RecommendationCard) => {
      const r = render(view(c));
      const out = rows(r.container).map(([label]) => label);
      r.unmount();
      return out;
    };
    expect(labels(card({ facts: { stepFree: true }, accessibility: access }))).not.toContain('Way in');
    // With no notes, or notes that are still a TODO, the fact is the only word on it; and a "No" is always said.
    expect(labels(card({ facts: { stepFree: true } }))).toContain('Way in');
    expect(labels(card({ facts: { stepFree: true }, accessibility: { text: 'TODO(Tyler & Sara): how to get in', placeholder: true } }))).toContain('Way in');
    const no = render(view(card({ facts: { stepFree: false }, accessibility: access })));
    expect(rows(no.container).find(([label]) => label === 'Way in')).toEqual(['Way in', ['No step-free way in']]);
  });

  it('reads as plain words: no codes, no em dashes, no 24-hour times', () => {
    const { container } = render(view(full));
    const words = rows(container).map(([label, lines]) => `${label} ${lines.join(' ')}`).join(' ');
    expect(words).not.toMatch(/[—–]|Mo-Th|07:00|walk-in|\$\$/);
  });
});

describe('the facts on a phone, in Botanical Deco', () => {
  it('marks the rows that run to several lines, so the stylesheet can set them under their label', () => {
    const { container } = render(<botanical.RecommendationCard card={full} headingLevel={2} />);
    const stacked = [...container.querySelectorAll('.bd-meta__row--stack')].map((r) => r.querySelector('dt')?.textContent);
    expect(stacked).toEqual(['Hours', 'Accessibility']);
    // One-line facts keep their label beside them.
    for (const row of container.querySelectorAll('.bd-meta__row:not(.bd-meta__row--stack)')) expect(row.querySelectorAll('dd > span').length, row.textContent ?? '').toBe(0);
  });
});
