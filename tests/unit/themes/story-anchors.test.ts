import { describe, expect, it } from 'vitest';
import { legacyAnchorsForSection, resolveStoryHash, STORY_LEGACY_ANCHORS } from '@/themes/shared/story-anchors';

describe('story anchor aliases', () => {
  it('maps merged timeline stops onto their chapter', () => {
    expect(resolveStoryHash('starved-rock')).toBe('love');
    expect(resolveStoryHash('#allison-and-jamies-wedding')).toBe('how-we-met');
    expect(resolveStoryHash('how-we-met')).toBe('how-we-met');
  });

  it('lists legacy ids for a merged section', () => {
    expect(legacyAnchorsForSection('the-connection')).toEqual(
      expect.arrayContaining(['museum-of-ice-cream', 'richardson-farm', 'gardening-together']),
    );
    expect(STORY_LEGACY_ANCHORS['madison-waterfront']).toBe('love');
  });
});
