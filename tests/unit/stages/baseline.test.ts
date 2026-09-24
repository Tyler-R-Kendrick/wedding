import { describe, expect, it } from 'vitest';
import { PAGES } from '@wedding/sitemap';
import { baselineFor, designsFor, frameDocument, frameFiles, parseFrameName, shapeOf, standIn, transformBody } from '@wedding/wireframe/baseline';

/**
 * Stages 2 to 4 redraw the real site as captured (stages/02-wireframe/lib/baseline.ts). These pin
 * the transforms; the capture itself is `npm run stages:capture` against production and the app.
 */
describe('the baseline', () => {
  it('holds every sitemap page, captured from the real site', () => {
    const missing = PAGES.filter((p) => !baselineFor(p.id)).map((p) => p.id);
    expect(missing, `capture them: npm run stages:capture -- --only ${missing.join(',')}`).toEqual([]);
  });

  it('holds production\'s design for every page, and says where each page came from', () => {
    for (const p of PAGES) {
      const meta = baselineFor(p.id)!;
      expect(designsFor(p.id)[0], p.id).toBe('botanical-deco');
      expect(meta.source, p.id).toMatch(/^https:\/\/kendrick\.wedding$|^app /);
      if (p.audience === 'guest' || p.audience === 'admin') expect(meta.principal, `${p.id} is captured signed in`).toBe(p.audience);
    }
  });

  it('writes one document per page for the wireframe and skeleton, one per design for the placeholder', () => {
    expect(frameFiles('wireframe')).toHaveLength(PAGES.length);
    expect(frameFiles('placeholder').length).toBeGreaterThan(PAGES.length);
    expect(parseFrameName('rsvp.gilded-hour.html')).toEqual({ pageId: 'rsvp', design: 'gilded-hour' });
    expect(parseFrameName('rsvp.html')).toEqual({ pageId: 'rsvp', design: 'botanical-deco' });
    expect(parseFrameName('nope.html')).toBeNull();
  });

  it('frames the real page with the real stylesheets and this stage\'s rules', () => {
    const doc = frameDocument('wedding', 'botanical-deco', 'skeleton', '/skeleton')!;
    expect(doc).toContain('data-bl-stage="skeleton"');
    expect(doc).toContain('data-theme="botanical-deco"');
    expect(doc).toMatch(/<link rel="stylesheet" href="\/skeleton\/baseline\/css\/[0-9a-f]{16}\.css">/);
    expect(doc).toContain('<base target="_top">');
    expect(doc).not.toMatch(/<script\b[^>]*\bsrc=/); // none of the site's scripts
  });
});

describe('stand-in copy', () => {
  it('is about as long as the real text, and says what it is', () => {
    const real = 'dress code in one sentence, with an example outfit.';
    const out = standIn(real);
    expect(out).toMatch(/^stand-in copy/);
    expect(Math.abs(out.length - real.length)).toBeLessThanOrEqual(6);
    expect(out.endsWith('.')).toBe(true);
  });

  it('keeps the shape of numbers, symbols, capitals and short words', () => {
    expect(standIn('Saturday, July 17, 2027')).toMatch(/^Stand-in/);
    expect(standIn('297')).toBe('000');
    expect(standIn('→')).toBe('→');
    expect(standIn('JUL')).toBe('XXX');
    expect(standIn('Sat')).toBe('Xxx');
    expect(standIn('THE REAL HEADLINE')).toBe(standIn('THE REAL HEADLINE').toUpperCase());
    expect(standIn('  padded  ')).toMatch(/^ {2}\S.*\S {2}$/);
  });
});

describe('the transforms', () => {
  const body = '<a href="/rsvp"><span data-bl-t="label">RSVP</span></a><p><span data-bl-t="copy">We are getting married.</span></p><img data-bl-m="art" src="/assets/a.svg"><div style="background: url(&quot;/assets/t.png&quot;)"></div><a href="https://maps.example/">x</a><a href="#main" target="_self">skip</a>';

  it('re-root links and assets at the stage, and leave external and in-page links alone', () => {
    const out = transformBody(body, 'wireframe', '/wireframe');
    expect(out).toContain('href="/wireframe/rsvp"');
    expect(out).toContain('src="/wireframe/baseline/a/assets/a.svg"');
    expect(out).toContain('url(&quot;/wireframe/baseline/a/assets/t.png');
    expect(out).toContain('href="https://maps.example/"');
    expect(out).toContain('href="#main"');
    expect(transformBody(body, 'wireframe', '')).toContain('href="/rsvp"');
  });

  it('swap copy for stand-ins at the placeholder only, and keep labels', () => {
    const placeholder = transformBody(body, 'placeholder', '');
    expect(placeholder).not.toContain('We are getting married');
    expect(placeholder).toMatch(/data-bl-t="copy">Stand-in copy/);
    expect(placeholder).toContain('>RSVP<');
    expect(transformBody(body, 'skeleton', '')).toContain('We are getting married');
  });

  it('fingerprint the shape, not the words: copy edits do not stale a sign-off, structure changes do', () => {
    const a = '<section data-bl-k="section" data-bl-label="What to wear"><p><span data-bl-t="copy">Black tie.</span></p></section>';
    const b = a.replace('Black tie.', 'Garden party.').replace('What to wear', 'Dress code');
    expect(shapeOf(b)).toBe(shapeOf(a));
    expect(shapeOf(a.replace('<p>', '<p class="lede">'))).not.toBe(shapeOf(a));
  });
});
