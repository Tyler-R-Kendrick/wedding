import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coverage, findUnmarked } from '../../scripts/check-standalone-links.mjs';

/**
 * Reintroduce the defect and the gate must go red, or it is decoration. Each case below is one the
 * gate got wrong at some point while it was being written, so they are regressions, not padding.
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
  '.wp-brand a { min-height: 44px; }\n' +
  '.gh-entry__title .gh-link { min-height: 44px; }\n' +
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
        '<p><a className="media-link--block" href="/x">a --block modifier</a></p>',
      ].join('\n'),
    });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('accepts a link sized through its paragraph, not through its own class', () => {
    // `.wp-brand a { min-height: 44px }` — the shape that made the first draft report a false
    // positive on `_recipes/kit.tsx`.
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p className="wp-brand"><Link href="/">Sara + Tyler</Link></p>' });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('exempts a link inside a sentence — SC 2.5.8 does, and block geometry would break the line', () => {
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p>Questions? <Link href="/ask">Ask us</Link>.</p>' });
    expect(findUnmarked(root)).toEqual([]);
  });

  it('does not count a rule that sizes below the target', () => {
    const root = fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '<p><a className="tiny" href="/x">24px is SC 2.5.8, not this repo</a></p>' });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('reads rem against the 17px root, so 2.75rem counts and 2rem does not', () => {
    const root = fixture({ 'src/a.css': '.big { min-height: 2.75rem; }\n.small { min-height: 2rem; }\n' , 'src/P.tsx': '<p><a className="big" href="/x">big</a></p>\n<p><a className="small" href="/x">small</a></p>' });
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

  it('cannot see a scope further above than SCOPE_LINES, and says so by failing', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<div className="gh-entry__title">', ...Array(20).fill('  {null}'), '  <p><a className="gh-link" href="/x">out of sight</a></p>'].join('\n'),
    });
    expect(findUnmarked(root)).toHaveLength(1);
  });

  it('reads `standalone={false}` as unmarked, because it is an opt-out from the rule', () => {
    const root = fixture({
      'src/a.css': TARGET_RULE,
      'src/P.tsx': ['<p><Link href="/x" standalone={false}>off</Link></p>', '<p><Link href="/y" standalone={true}>on</Link></p>'].join('\n'),
    });
    const found = findUnmarked(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('off');
  });

  it('does not take classes out of a comment sitting above a rule', () => {
    const root = fixture({
      'src/a.css': '/* measured by scripts/check-standalone-links.mjs */\n.link-block { min-height: 44px; }\n',
      'src/P.tsx': '',
    });
    expect(coverage(root).onSelf.has('mjs')).toBe(false);
  });

  it('separates self-coverage from ancestor-coverage', () => {
    const { onSelf, onAncestor } = coverage(fixture({ 'src/a.css': TARGET_RULE, 'src/P.tsx': '' }));
    expect(onSelf.has('link-block')).toBe(true);
    expect(onAncestor.has('wp-brand')).toBe(true);
    expect(onSelf.has('wp-brand')).toBe(false);
  });
});
