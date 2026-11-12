import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecommendationCardView } from '@/app/(public)/_recipes/kit';
import type { ProvenanceViewData, RecommendationCard } from '@/domain/content/views';
import { content as botanical } from '@/themes/botanical-deco/kit/content';

/*
 * A recommendation's facts on its page, in both kits: a row for each fact the record holds, in
 * plain words, and no row for one it does not.
 */
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
  ['Hours', ['Monday to Thursday: 7 am to 6 pm', 'Friday and Saturday: 7 am to 8 pm', 'Sunday: Closed', 'Shorter hours in winter.', 'Hours change, so check with the place before you go.']],
  ['Booking', ['Booking is a good idea']],
  ['Diet options', ['Vegetarian and vegan options on the menu']],
  ['Accessibility', ['Lift from the lobby.']],
  ['Step-free way in', ['No step-free way in']],
  ['Indoors or outdoors', ['Indoors and outdoors']],
  ['With kids', ['Better without']],
  ['Ages', ['21 and over']],
];
const FACT_LABELS = ['Price', 'Hours', 'Booking', 'Diet options', 'Step-free way in', 'Indoors or outdoors', 'Ages'];
const full = card({ facts, kidFriendly: false, cost: { text: 'About $60 each with a drink.', placeholder: false }, accessibility: { text: 'Lift from the lobby.', placeholder: false } });

/** Each term of a description list with the lines of its description, whatever element keeps them apart. */
function rows(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll('dt')].map((dt) => {
    const dd = dt.nextElementSibling as HTMLElement;
    const spans = [...dd.children].filter((c) => c.tagName === 'SPAN');
    const lines = spans.length > 1 ? spans.map((s) => s.textContent ?? '') : dd.innerHTML.includes('<br>') ? dd.innerHTML.split('<br>') : [dd.textContent ?? ''];
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
      ['Step-free way in', ['Yes']],
    ]);
  });

  it('reads as plain words: no codes, no em dashes, no 24-hour times', () => {
    const { container } = render(view(full));
    const words = rows(container).map(([label, lines]) => `${label} ${lines.join(' ')}`).join(' ');
    expect(words).not.toMatch(/[—–]|Mo-Th|07:00|walk-in|\$\$/);
  });
});
