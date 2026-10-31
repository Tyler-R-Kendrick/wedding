import { describe, expect, it } from 'vitest';
import { loadContentSeed } from '@/content';
import { guestText } from '@/domain/content/text';
import { DRESS_CODE_FAQ_ANSWER, DRESS_CODE_INTRO, DRESS_CODE_SHORT } from '@/domain/venue/dress-code';

describe('dress code copy', () => {
  it('matches the FAQ seed answer', () => {
    const faq = loadContentSeed().faq.find((e) => e.slug === 'dress-code');
    expect(faq?.answer).toBe(DRESS_CODE_FAQ_ANSWER);
    expect(faq?.placeholder).toBe(false);
  });

  it('guestText leaves the settled sentences intact', () => {
    expect(guestText(DRESS_CODE_FAQ_ANSWER)).toContain('cocktail attire');
    expect(guestText(DRESS_CODE_INTRO)).toContain('Black tie is welcome');
  });

  it('short line names cocktail-and-up', () => {
    expect(DRESS_CODE_SHORT).toMatch(/Cocktail attire and up/i);
  });
});
