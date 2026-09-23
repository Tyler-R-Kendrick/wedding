import { describe, expect, it } from 'vitest';
import { PAGES, STAGES, href, matches, pageForUrl, staticParams, trail, validateSitemap } from '../lib';

describe('sitemap', () => {
  it('is structurally valid', () => {
    expect(validateSitemap()).toEqual([]);
  });

  it('resolves every page from its own URL', () => {
    for (const p of PAGES) expect(pageForUrl(href(p))?.id, href(p)).toBe(p.id);
  });

  it('prefers an exact path over a pattern', () => {
    expect(pageForUrl('/admin/content/example/new')?.id).toBe('admin-content-new');
    expect(pageForUrl('/admin/content/example/row')?.id).toBe('admin-content-row');
  });

  it('matches patterns segment by segment', () => {
    expect(matches('/our-adventures/[slug]', '/our-adventures/paris')).toBe(true);
    expect(matches('/our-adventures/[slug]', '/our-adventures')).toBe(false);
    expect(matches('/our-adventures/[slug]', '/our-adventures/paris/extra')).toBe(false);
  });

  it('gives every page a static param set, root included', () => {
    const params = staticParams();
    expect(params).toHaveLength(PAGES.length);
    expect(params).toContainEqual({ path: [] });
  });

  it('builds trails from the root', () => {
    expect(trail('rsvp-step').map((p) => p.id)).toEqual(['weekend', 'rsvp', 'rsvp-step']);
  });

  it('catches the mistakes that would break a later stage', () => {
    const bad = [
      ...PAGES.slice(0, 2),
      { ...PAGES[2]!, id: 'x', path: '/x/[slug]', parent: 'nope', primaryAction: { label: 'Go', to: 'missing' } },
    ];
    const errors = validateSitemap(bad);
    expect(errors.some((e) => e.includes('needs an example'))).toBe(true);
    expect(errors.some((e) => e.includes('parent "nope"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown page "missing"'))).toBe(true);
  });

  it('numbers the stages 1–5 with distinct dev ports', () => {
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(STAGES.map((s) => s.devPort)).size).toBe(STAGES.length);
  });
});
