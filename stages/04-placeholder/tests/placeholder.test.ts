import { describe, expect, it } from 'vitest';
import type { Slot } from '@wedding/skeleton';
import { paragraph, placeholderFor } from '../lib/placeholder';

const slot = (over: Partial<Slot>): Slot => ({ key: 'home/b/p0', page: 'home', block: 'b', part: 'p0', label: 'Story teaser', shape: { kind: 'text', lines: 4 }, ...over });

describe('placeholder content', () => {
  it('sizes a paragraph to its slot and says what it stands in for', () => {
    const p = paragraph('Story teaser', 4);
    expect(p.startsWith('This stands in for story teaser.')).toBe(true);
    expect(p.split(' ').length).toBeGreaterThanOrEqual(44);
  });

  it('never invents a fact: a value beside a label is a TODO', () => {
    expect(placeholderFor(slot({ part: 'fact-0', label: 'Dress code', shape: { kind: 'line' } }))).toBe('TODO(Tyler & Sara)');
  });

  it('never uses lorem ipsum', () => {
    expect(paragraph('Anything', 12)).not.toMatch(/lorem|ipsum/i);
  });

  it('describes an image instead of faking one', () => {
    expect(placeholderFor(slot({ part: 'image', label: 'Lead image', shape: { kind: 'media', aspect: 'wide' } }))).toBe('Image: Lead image');
  });

  it('applies overrides by key, and site-wide ones to every page', () => {
    expect(placeholderFor(slot({ key: 'rsvp/site/name', page: 'rsvp', block: 'site', part: 'name', shape: { kind: 'line' } }))).toBe('Sara + Tyler');
  });
});
