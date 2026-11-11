import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { kit, More } from '@/themes/botanical-deco/kit';

/**
 * The external mark says "opens in a new tab". Every link that carries it has to do that: a guest
 * who follows "Book your room" should still have the wedding site open behind it.
 */
describe('links that carry the external mark', () => {
  it('open in a new tab, and links inside the site do not', () => {
    const { container } = render(
      <div>
        <kit.Link href="https://example.com/hotel">Visit the hotel website</kit.Link>
        <kit.Button variant="external" href="https://example.com/book">
          Book your room
        </kit.Button>
        <kit.Button href="https://example.com/also">Outside, primary style</kit.Button>
        <More href="https://example.com/more">Read more</More>
        <kit.Link href="/guests">Your weekend</kit.Link>
        <More href="/our-story">Read our story</More>
      </div>,
    );
    const anchors = [...container.querySelectorAll('a')];
    const marked = anchors.filter((a) => a.querySelector('.bd-external'));
    expect(marked).toHaveLength(3);
    for (const a of marked) {
      expect(a.getAttribute('target'), a.textContent ?? '').toBe('_blank');
      expect(a.getAttribute('rel'), a.textContent ?? '').toContain('noopener');
      expect(a.textContent, a.textContent ?? '').toContain('in a new tab');
    }
    // Any other link that leaves the site does the same; links within it stay in this tab.
    for (const a of anchors) {
      const leaves = /^https?:/.test(a.getAttribute('href') ?? '');
      expect(a.getAttribute('target'), a.textContent ?? '').toBe(leaves ? '_blank' : null);
    }
  });
});
