import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coverage, findUnmarked } from '../../scripts/check-standalone-links.mjs';

/**
 * Reintroduce the defect and the gate must go red, or it is decoration. Each case below is one the
 * gate got wrong at some point, so they are regressions, not padding — and each was checked by
 * mutating the script and watching THIS test fail, because a test that passes either way pins
 * nothing. Three of the twelve that shipped first did exactly that and are rewritten here.
 */
const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'targets-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const TARGET_RULE =
  '.link-block { min-height: 44px; }\n' +
  '.media-link--block { min-height: 44px; }\n' +
  '.wp-brand a { min-height: 44px; }\n' +
  '.gh-entry__title .gh-link { min-height: 44px; }\n' +
  '.wp-why summary { min-height: 44px; }\n' +
  '.tiny { min-height: 24px; }\n';

describe('the standalone-link gate', () => {
  it('fails a paragraph whose whole content is an unmarked link', () => {
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p><Link href="/x">All adventures</Link></p>' });
    const found = findUnmarked(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ tag: 'Link', classes: '(none)' });
  });

  it('accepts the three ways a link can carry the target', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': [
        '<p><Link href="/x" standalone>prop</Link></p>',
        '<p><a className="link-block" href="/x">class named by a 44px rule</a></p>',
        '<p className="wp-brand"><Link href="/">a scope that sizes anchors</Link></p>',
      ].join('\n'),
    });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('wants a real rule behind a `--block` class, not the suffix', () => {
    // `.todo--block` is a real class in this repo and sets no min-height at all.
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<p><a className="media-link--block" href="/x">has a rule</a></p>', '<p><a className="todo--block" href="/y">has none</a></p>'].join('\n'),
    });
    const found = findUnmarked(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.classes).toBe('todo--block');
  });

  it('exempts a paragraph holding two links — block geometry would break the line', () => {
    // The shape the sentence guard is the only thing standing between. The earlier fixture for
    // this, `<p>Questions? <Link/>.</p>`, never reached the guard: PARAGRAPH_LINK requires the
    // anchor to follow `<p>` immediately, so it returned [] with the guard deleted too.
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p><a href="/x">Chicago</a> or <a href="/y">Evanston</a></p>' });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('reports a link whose label carries a visually-hidden suffix', () => {
    // Four live links on /travel were exempted as "sentences" because of this span. They measured
    // 17px each. A label's own markup is not prose.
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': '<p><a href="/x">Continue on Skyscanner<span className="sr-only"> (opens in a new tab)</span></a></p>',
    });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('tests a paragraph that sits below one ending in trailing prose', () => {
    // An untempered lazy body backtracks past its own `</p>` to the next `</a></p>` in the file,
    // and matchAll resumes after that region, so the second paragraph was never looked at.
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<p><a href="/a">Search the photos</a> by what you remember.</p>', '<p><a href="/b">no target</a></p>'].join('\n'),
    });
    const found = findUnmarked(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('no target');
  });

  it('does not count a rule that sizes below the target', () => {
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p><a className="tiny" href="/x">24px is SC 2.5.8, not this repo</a></p>' });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('reads rem against the 17px root, so 2.7rem counts and 2.5rem does not', () => {
    // 2.7rem is 45.9px at 17 and 43.2px at 16, so this goes red for any other root. 2.75rem — the
    // value that shipped first — is 44.00px at 16 as well, which pinned nothing.
    const root = fixture({ 'src/a.css': '.big { min-height: 2.7rem; }\n.small { min-height: 2.5rem; }\n', 'src/P.tsx': '<p><a className="big" href="/x">big</a></p>\n<p><a className="small" href="/x">small</a></p>' });
    const found = findUnmarked(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.classes).toBe('small');
  });

  it('does not let a scoped rule cover its last compound on its own', () => {
    // `.gh-entry__title .gh-link` sizes `.gh-link` only INSIDE the title. Crediting `gh-link` for
    // it accepted every link both kits render, since `<Link>` always emits that base class.
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p><a className="gh-link" href="/x">loose</a></p>' });
    expect(findUnmarked(root)).toHaveLength(1);
    expect(coverage(root).onSelf.has('gh-link')).toBe(false);
  });

  it('accepts that same link once its scope is visible above the paragraph', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<h2 className="gh-entry__title">', '  <p><a className="gh-link" href="/x">in scope</a></p>', '</h2>'].join('\n'),
    });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('will not let a scope shelter a link it cannot size', () => {
    // `.wp-why summary` sizes a <summary>. It sheltered every link under a `<details class=
    // "wp-why">` — including one of the thirteen this gate's own change had to fix.
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<details className="wp-why">', '  <summary>Why</summary>', '  <p><a href="/x">Read the memory</a></p>', '</details>'].join('\n'),
    });
    expect(findUnmarked(root)).toHaveLength(1);
    expect(coverage(root).onAncestor.has('wp-why')).toBe(false);
  });

  it('will not let a scope shelter a link that does not match its subject', () => {
    // `.gh-entry__title .gh-link` is in scope, but this anchor is not a `.gh-link`.
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<h2 className="gh-entry__title">', '  <p><a className="something-else" href="/x">not the subject</a></p>', '</h2>'].join('\n'),
    });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('cannot see a scope further above than SCOPE_LINES, and says so by failing', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<div className="gh-entry__title">', ...Array(20).fill('  {null}'), '  <p><a className="gh-link" href="/x">out of sight</a></p>'].join('\n'),
    });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('reads `standalone={false}` as unmarked, however it is spaced', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': [
        '<p><Link href="/x" standalone={false}>off</Link></p>',
        '<p><Link href="/y" standalone = {false}>spaced off</Link></p>',
        '<p><Link href="/z" standalone={true}>on</Link></p>',
      ].join('\n'),
    });
    expect(findUnmarked(root).map((f) => f.text)).toEqual(['off', 'spaced off']);
  });

  it('does not take classes out of a comment sitting above a rule', () => {
    // Stripping comments is what keeps `.link-block` in onSelf: with the comment left in, the
    // selector is six compounds long and the class the rule names is credited to nothing.
    const { onSelf, onAncestor } = coverage(fixture({
      'src/a.css': '/* measured by scripts/check-standalone-links.mjs */\n.link-block { min-height: 44px; }\n',
      'src/P.tsx': '',
    }));
    expect(onSelf.has('link-block')).toBe(true);
    expect(onSelf.has('mjs')).toBe(false);
    expect(onAncestor.has('mjs')).toBe(false);
  });

  it('does not read a class out of a pseudo-class argument list', () => {
    // `selectors.split(',')` cut `:is(p, td) a` in half and `:not(.bar)` donated `bar` as if a
    // rule sized it. Latent — no 44px rule in this tree has a functional pseudo-class yet — but
    // `.ops :is(p, td, dd, li, figcaption) a` is exactly where one would go.
    const { onSelf, onAncestor } = coverage(fixture({
      'src/a.css': '.foo:not(.bar, .baz) { min-height: 44px; }\n:where(.wrap, .other) .kid { min-height: 44px; }\n.ops :is(p, td) a { min-height: 44px; }\n',
      'src/P.tsx': '',
    }));
    expect(onSelf.has('foo')).toBe(true);
    expect(onSelf.has('bar')).toBe(false);
    // A naive `split(',')` leaves `:where(.wrap` as its own selector, one compound long, and
    // `wrap` is then credited with carrying the geometry itself.
    expect(onSelf.has('wrap')).toBe(false);
    expect(onAncestor.has('ops')).toBe(true);
  });

  it('separates self-coverage from ancestor-coverage', () => {
    const { onSelf, onAncestor } = coverage(fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '' }));
    expect(onSelf.has('link-block')).toBe(true);
    expect(onAncestor.has('wp-brand')).toBe(true);
    expect(onSelf.has('wp-brand')).toBe(false);
  });

  it('holds over this repo, not only over fixtures', () => {
    // The same assertion `npm run targets:check` makes, run where CI already runs unit tests, so
    // the gate cannot be green in one place and absent in the other.
    expect(findUnmarked()).toEqual([]);
  });
});
