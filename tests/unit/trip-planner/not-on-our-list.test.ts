import { describe, expect, it } from 'vitest';
import { CLEAR_HIT_MARGIN, clearHit, compose, draftPlan, mergeWritten } from '@/domain/trip-planner';
import { BY_ID, PLACES } from './fixtures';

/**
 * Score maps shaped like the installed matcher's real ones (see CLEAR_HIT_MARGIN in draft.ts): a
 * clear hit stands about 0.1 or more above the list's median; a miss is level with the whole list,
 * its best a few hundredths above many others.
 */
const spread = (lo: number, hi: number) => new Map(PLACES.map((p, i) => [p.id, lo + ((hi - lo) * i) / (PLACES.length - 1)]));
const CLEAR = new Map([...spread(0.4, 0.5)].map(([id, v]) => [id, id === 'aquarium' ? 0.58 : v]));
const NEAR_TIE = new Map([...spread(0.42, 0.47)].map(([id, v]) => [id, id === 'corner-roastery' ? 0.485 : v]));

describe('a request our list does not cover', () => {
  it('reads the score shapes: a clear hit, and a near tie that is not one', () => {
    expect(clearHit(CLEAR, PLACES)).toBe(true);
    expect(clearHit(NEAR_TIE, PLACES)).toBe(false);
    expect(CLEAR_HIT_MARGIN).toBeGreaterThan(0.05);
    expect(CLEAR_HIT_MARGIN).toBeLessThan(0.1);
  });

  it('a near tie with no rule and no shared words says so, with no places presented as matches', () => {
    const plan = draftPlan({ request: 'Somewhere to buy a suit', places: PLACES, saved: [], scores: NEAR_TIE });
    expect(plan.shape).toBe('ask');
    expect(plan.title).toBe('That one is not on our list');
    expect(plan.intro).not.toMatch(/!/);
    expect(plan.picks).toEqual([]);
    expect(plan.candidates).toEqual([]);
    // The question offers the kinds of things we do have, each a request the planner understands.
    const options = plan.question!.options.map((o) => o.label);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options).toContain('Food and drink');
    for (const label of options) {
      const next = draftPlan({ request: label, places: PLACES, saved: [] });
      expect(next.shape, label).not.toBe('ask');
    }
    const program = compose(plan, { places: BY_ID, saved: [] });
    expect(program).not.toContain('Place(');
    expect(program).toContain('Choice(');
    // The writer cannot turn it back into a recommendation.
    const merged = mergeWritten(plan, 'TITLE: Great suits nearby\nINTRO: Try these.\n', PLACES, { complete: true });
    expect(merged.title).toBe(plan.title);
    expect(merged.intro).toBe(plan.intro);
  });

  it('a clear hit with no rule still answers with the place the matcher found', () => {
    const plan = draftPlan({ request: 'Somewhere to see sharks', places: PLACES, saved: [], scores: CLEAR });
    expect(plan.shape).not.toBe('ask');
    expect(plan.picks[0]!.id).toBe('aquarium');
  });

  it('a keyword hit with no scores answers with the places that use the word, and only those', () => {
    const plan = draftPlan({ request: 'Somewhere with bocce', places: PLACES, saved: [] });
    expect(plan.shape).toBe('picks');
    expect(plan.picks.map((p) => p.id)).toEqual(['game-room']);
    // With the matcher too, a shared word is a rule: never "not on our list".
    expect(draftPlan({ request: 'Somewhere with bocce', places: PLACES, saved: [], scores: NEAR_TIE }).title).not.toBe('That one is not on our list');
  });

  it('a request a rule reads is never "not on our list", whatever the scores', () => {
    for (const request of ['Somewhere for coffee', 'Something with the kids', 'I have two hours', 'Saturday morning'])
      expect(draftPlan({ request, places: PLACES, saved: [], scores: NEAR_TIE }).title, request).not.toBe('That one is not on our list');
  });

  it('without the matcher the gentler "tell us more" answer stays', () => {
    const plan = draftPlan({ request: 'Somewhere to buy a suit', places: PLACES, saved: [] });
    expect(plan.shape).toBe('ask');
    expect(plan.title).toBe('Tell us a little more and we will plan it');
  });
});
