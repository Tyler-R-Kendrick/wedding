import { describe, expect, it } from 'vitest';
import { draftPlan, mergeWritten, writerPrompt } from '@/domain/trip-planner';
import { PLACES } from './fixtures';

const coffee = draftPlan({ request: 'Somewhere for coffee', places: PLACES, saved: [] });

describe('writerPrompt', () => {
  it('stays small: only the candidates, one worked example, and the draft', () => {
    const { system, prompt } = writerPrompt({ request: 'Somewhere for coffee', draft: coffee, places: PLACES });
    const placeLines = prompt.split('\n').filter((l) => / \| /.test(l) && !/^PICK:/.test(l));
    expect(placeLines.length).toBeLessThanOrEqual(12);
    expect(placeLines.length).toBe(coffee.candidates!.length);
    expect(system.match(/^Example$/gm)).toHaveLength(1);
    expect(system).toMatch(/TITLE: .*\nINTRO: .*\nPICK: <id> \| .*\nNEXT: /);
    expect(prompt).toContain(`TITLE: ${coffee.title}`);
    expect(system.length + prompt.length).toBeLessThan(4000);
  });
});

describe('mergeWritten', () => {
  it('takes well-formed lines and keeps the draft for the rest', () => {
    const merged = mergeWritten(coffee, 'TITLE: A slow coffee before the day begins\nPICK: corner-roastery | Our reading-room favourite.\nPICK: bean-house | The long counter.\n', PLACES);
    expect(merged.title).toBe('A slow coffee before the day begins');
    expect(merged.intro).toBe(coffee.intro);
    expect(merged.picks.map((p) => p.id)).toEqual(['corner-roastery', 'bean-house']);
    expect(merged.picks[0]).toMatchObject({ note: 'Our reading-room favourite.', day: 'sat', part: 'morning' });
    expect(merged.next).toEqual(coffee.next);
  });

  it('ignores an unfinished last line until the stream is complete', () => {
    expect(mergeWritten(coffee, 'TITLE: Half a tit', PLACES).title).toBe(coffee.title);
    expect(mergeWritten(coffee, 'TITLE: A whole title', PLACES, { complete: true }).title).toBe('A whole title');
  });

  it('survives garbage: an echoed template, invented ids, prose, markdown, repeats and off-limits words', () => {
    const garbage = [
      'Sure! Here is my answer:',
      '```',
      'TITLE: one specific sentence about this request, at most ten words',
      'TITLE: <title>',
      '- **TITLE:** Coffee, the way we like it 😊!',
      'TITLE: A second title that must not win',
      'INTRO: As an AI model I recommend these.',
      'INTRO: Two counters we keep going back to.',
      '* PICK: `made-up-cafe` | Invented.',
      'PICK: bean-house | Open until 9 pm, 5 minutes away.',
      'PICK: bean-house | A repeat that must not win.',
      'PICK: tasting-room | Not one of the draft\'s candidates.',
      '1. PICK: corner-roastery|Quiet and bright',
      'PICK: <id> | one short line',
      'NEXT: Add a walk after coffee',
      'NEXT: Add a walk after coffee',
      'NEXT: <request>',
      '```',
      'PICK: hotel-cafe | cut off mid-sen',
    ].join('\n');
    const merged = mergeWritten(coffee, garbage, PLACES);
    expect(merged.title).toBe('Coffee, the way we like it.');
    expect(merged.intro).toBe('Two counters we keep going back to.');
    expect(merged.picks.map((p) => p.id)).toEqual(['bean-house', 'corner-roastery']);
    // A note that states a time or a distance is dropped; the place stays.
    expect(merged.picks[0]!.note).toBeUndefined();
    expect(merged.picks[1]!.note).toBe('Quiet and bright');
    expect(merged.next[0]).toBe('Add a walk after coffee');
    expect(merged.next).toHaveLength(Math.min(3, 1 + coffee.next.length));
  });

  it('a model that only echoes the draft changes nothing that matters', () => {
    const echo = writerPrompt({ request: 'x', draft: coffee, places: PLACES }).prompt.split('\n').filter((l) => /^(TITLE|INTRO|PICK|NEXT):/.test(l)).join('\n');
    const merged = mergeWritten(coffee, `${echo}\n`, PLACES);
    expect(merged.title).toBe(coffee.title);
    expect(merged.picks.map((p) => p.id)).toEqual(coffee.picks.map((p) => p.id));
  });

  it('one valid PICK annotates but does not replace the draft picks', () => {
    const merged = mergeWritten(coffee, 'PICK: corner-roastery | Our quiet one.\n', PLACES);
    expect(merged.picks.map((p) => p.id)).toEqual(coffee.picks.map((p) => p.id));
    expect(merged.picks.find((p) => p.id === 'corner-roastery')!.note).toBe('Our quiet one.');
  });

  it('keeps the structure of a switch, a budget and a weekend: notes only', () => {
    const dinner = draftPlan({ request: 'Where should we get dinner?', places: PLACES, saved: [] });
    const text = dinner.picks.map((p) => `PICK: ${p.id} | Ours.`).reverse().join('\n') + '\n';
    const merged = mergeWritten(dinner, text, PLACES);
    expect(merged.picks.map((p) => p.id)).toEqual(dinner.picks.map((p) => p.id));
    expect(merged.groups).toEqual(dinner.groups);
    expect(merged.picks.every((p) => p.note === 'Ours.')).toBe(true);

    const budget = draftPlan({ request: 'I have two hours', places: PLACES, saved: [] });
    const b = mergeWritten(budget, budget.picks.map((p) => `PICK: ${p.id} | Words.`).join('\n') + '\n', PLACES);
    expect(b.picks).toEqual(budget.picks);
  });

  it('never lets the writer touch a plan that has nothing to pick from', () => {
    const stay = draftPlan({ request: 'Where should I stay?', places: PLACES, saved: [] });
    const merged = mergeWritten(stay, 'PICK: bean-house | x\nTITLE: Our room block, first\n', PLACES);
    expect(merged.picks).toEqual([]);
    expect(merged.title).toBe('Our room block, first');
  });

  it('drops any line that sends guests to the wedding: Saturday afternoon, evening or night, or tonight', () => {
    const lines = [
      'TITLE: Dinner after the ceremony on Saturday night',
      'TITLE: Book a table for Saturday evening',
      'TITLE: Something for tonight',
      "INTRO: Saturday's evening is free for a long dinner.",
      'INTRO: Go on Saturday afternoon, before anything else.',
      'PICK: bean-house | Perfect for Saturday evening.',
      'PICK: corner-roastery | Stop by tonight.',
    ].join('\n');
    const merged = mergeWritten(coffee, `${lines}\n`, PLACES);
    expect(merged.title).toBe(coffee.title);
    expect(merged.intro).toBe(coffee.intro);
    for (const p of merged.picks) expect(p.note ?? '').not.toMatch(/saturday|tonight/i);
    // A line that keeps to the morning is still taken.
    expect(mergeWritten(coffee, 'TITLE: Coffee on Saturday morning\n', PLACES).title).toBe('Coffee on Saturday morning');
  });

  it('tolerates non-string input', () => {
    expect(mergeWritten(coffee, undefined as unknown as string, PLACES)).toEqual({ ...coffee });
  });
});
