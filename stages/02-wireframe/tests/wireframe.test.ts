import { describe, expect, it } from 'vitest';
import { PAGES, page } from '@wedding/sitemap';
import { AUTHORED, allWireframes, coverage, derive, linksFrom, validateWireframes, walk, type Wireframe } from '../lib';
import { baselineFor } from '../lib/baseline';

/** A drawing with nested blocks, as a planned page would have. */
const DRAWN: Wireframe = {
  page: 'weekend',
  status: 'draft',
  blocks: [
    { kind: 'masthead', title: 'Your weekend' },
    { kind: 'split', columns: [[{ kind: 'facts', label: 'When', items: ['Day'] }], [{ id: 'rsvp-status', kind: 'prose', label: 'Reply', paragraphs: 1 }]] },
  ],
};

describe('wireframes', () => {
  it('are valid against the current sitemap', () => {
    expect(validateWireframes()).toEqual([]);
  });

  it('cover every sitemap page, drawn or derived', () => {
    expect(allWireframes().map((w) => w.page)).toEqual(PAGES.map((p) => p.id));
    const c = coverage();
    expect(c.total).toBe(PAGES.length);
    expect(c.derived + c.draft + c.review + c.approved).toBe(c.total);
  });

  it('derive a page the moment it appears in the sitemap (the cascade)', () => {
    const newcomer = { ...page('gifts'), id: 'registry-faq', path: '/gifts/faq', title: 'Gift questions', parent: 'gifts', primaryAction: { label: 'Gifts', to: 'gifts' } };
    const w = derive(newcomer);
    expect(w.status).toBe('derived');
    expect(w.blocks[0]).toMatchObject({ kind: 'masthead', title: 'Gift questions' });
    expect(linksFrom(w)).toContain('gifts');
  });

  it('derive an admin page as a table and a door as a form', () => {
    expect(derive(page('admin-flags')).blocks.map((b) => b.kind)).toContain('table');
    expect(derive(page('sign-out')).blocks.map((b) => b.kind)).toContain('form');
  });

  it('flag a wireframe whose page or link left the sitemap', () => {
    const errors = validateWireframes({
      ...AUTHORED,
      ghost: { blocks: [{ kind: 'masthead', title: 'Ghost' }] },
      home: { blocks: [{ kind: 'masthead', title: 'Home', actions: [{ label: 'Go', to: 'gone' }] }] },
    });
    expect(errors).toContain('wireframe "ghost" has no page in the sitemap');
    expect(errors.some((e) => e.includes('"gone"'))).toBe(true);
  });

  it('give nested blocks stable, unique ids', () => {
    const ids: string[] = [];
    walk(DRAWN.blocks, (_b, id) => ids.push(id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('rsvp-status'); // an explicit id is kept as written
    expect(ids).toContain('split-1.0.facts-0'); // a derived one carries its path
  });

  it('are only drawn for pages not built yet: a captured page is shown as production renders it', () => {
    const outlived = Object.keys(AUTHORED).filter((id) => baselineFor(id));
    expect(outlived, 'these pages are captured; delete their drawings (lib/index.ts)').toEqual([]);
  });
});

describe('fingerprints', () => {
  it('are stable, ignore key order and status, and change with content', async () => {
    const { fingerprint } = await import('../lib');
    const w = DRAWN;
    expect(fingerprint(w)).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint({ ...w, status: 'approved' })).toBe(fingerprint(w));
    const reordered = { ...w, blocks: w.blocks.map((b) => Object.fromEntries(Object.entries(b).reverse()) as typeof b) };
    expect(fingerprint(reordered)).toBe(fingerprint(w));
    expect(fingerprint({ ...w, blocks: [...w.blocks, { kind: 'prose', label: 'New' }] })).not.toBe(fingerprint(w));
  });
});
