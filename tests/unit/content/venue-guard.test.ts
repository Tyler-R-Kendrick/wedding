import { describe, expect, it } from 'vitest';
import { mentionsVenue, publicBlocks, withoutVenueSentences } from '@/domain/content/venue-guard';

const CHAPTER =
  'By our fourth date, something had shifted. Tyler planned one of his Chicago tours for Sara, showing her some of his favorite places around the city, including the Chicago Athletic Association. We ended the evening at Michael Jordan’s Steak House, laughing and smiling throughout dinner. Little did we know that the Chicago Athletic Association would one day be where we’d say “I do.” Along the way we kept finding places that felt like ours.';

describe('venue guard: the story is public, the venue is not', () => {
  it('drops every sentence that names the venue and keeps the rest in order', () => {
    const out = withoutVenueSentences(CHAPTER);
    expect(out).not.toMatch(/Chicago Athletic/i);
    expect(out).not.toMatch(/say “I do/);
    expect(out).toBe('By our fourth date, something had shifted. We ended the evening at Michael Jordan’s Steak House, laughing and smiling throughout dinner. Along the way we kept finding places that felt like ours.');
  });

  it('leaves copy that never names the venue exactly as written', () => {
    const text = 'We met at a friend’s wedding.  Two spaces and all.';
    expect(withoutVenueSentences(text)).toBe(text);
  });

  it('sees the address and the short name too', () => {
    expect(mentionsVenue('See you at 12 S Michigan Ave.')).toBe(true);
    expect(mentionsVenue('12 South Michigan Avenue, Chicago')).toBe(true);
    expect(mentionsVenue('the Chicago  Athletic hotel')).toBe(true);
    expect(mentionsVenue('A walk down Michigan Avenue to the river.')).toBe(false);
    expect(mentionsVenue('One of his Chicago tours.')).toBe(false);
  });

  it('drops a paragraph that was nothing but the venue', () => {
    const blocks = [
      { text: 'We got engaged in the spring.', placeholder: false },
      { text: 'The wedding is at the Chicago Athletic Association Hotel.', placeholder: false },
    ];
    expect(publicBlocks(blocks)).toEqual([{ text: 'We got engaged in the spring.', placeholder: false }]);
  });
});
