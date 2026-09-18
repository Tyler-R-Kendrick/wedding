#!/usr/bin/env node
/**
 * A link that is the whole of its paragraph is a touch target, not a word in a sentence, so
 * `wedding-site-standards` §7 asks for 44px. This finds the ones nobody gave it to.
 *
 * CSS cannot find them on its own. `p > a:only-child` counts ELEMENT children, so it matches an
 * anchor sitting in a sentence just as readily, and giving those block geometry would break the
 * line. That is why both kits carry a `standalone` prop for the call site to declare the case —
 * and why a call site can forget. Six did in one commit, two of them four lines from a link that
 * had been marked correctly.
 *
 * A browser sweep does not catch them either, and that is the point of reading the source instead:
 * the six were behind `venue.block.url`, `h.bookingUrl` and `detail.webFull`, and the fixtures do
 * not produce those, so the links never rendered to be measured. Eight more live in the fallback
 * recipes under `app/(public)/_recipes`, which render only for a theme that has no recipe of its
 * own. A data-gated branch is as visible here as any other.
 *
 * Two deliberate limits:
 *
 *   * Paragraphs only. A link that is the whole of an `<li>` is usually a nav item, and nav lists
 *     size their own anchors through a descendant rule (`.con-nav__bar a`), which this cannot see.
 *     Scoping to `<p>` keeps every finding actionable instead of drowning them in 15 that are fine.
 *   * The covered set is READ OUT OF THE CSS, not listed here: any rule that sets a min-height of
 *     44px or more contributes its selectors' classes. Rename a class or drop one out of a
 *     touch-target rule and this gate moves with it, instead of trusting a list that rots.
 *
 * Coverage comes in two shapes, and missing the second is what made the first draft of this report
 * `_recipes/kit.tsx:32` — a link inside `<p className="wp-brand">`, where `.wp-brand a` has set
 * `min-height: 44px` all along. So a rule whose selector ends in a bare `a` marks its ancestor
 * class as covering the anchors beneath it, and a paragraph carrying that class is accepted.
 */
import { readFileSync, globSync } from 'node:fs';

const MIN_TARGET_PX = 44;
const ROOT_FONT_PX = 17; // `html { font-size: 17px }` — the rem ramp is built on it.

/**
 * Two sets, read from the stylesheets themselves:
 *   `onSelf`     — classes a >= 44px rule names directly (`.link-block`, `.gh-link--standalone`)
 *   `onAncestor` — classes whose rule sizes the anchors BENEATH them (`.wp-brand a`)
 */
export function coverage(cwd = '.') {
  const onSelf = new Set();
  const onAncestor = new Set();
  for (const file of globSync('src/**/*.css', { cwd })) {
    const css = readFileSync(`${cwd}/${file}`, 'utf8');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const min = /min-height:\s*(\d+(?:\.\d+)?)(px|rem)/.exec(body);
      if (!min) continue;
      const px = min[2] === 'rem' ? parseFloat(min[1]) * ROOT_FONT_PX : parseFloat(min[1]);
      if (px < MIN_TARGET_PX) continue;
      for (const selector of selectors.split(',')) {
        const trimmed = selector.trim();
        if (!trimmed || trimmed.startsWith('@')) continue;
        // `.foo a`, `.foo > a`, `.foo bar a:hover` — the rule sizes descendant anchors.
        const descendant = /^(.*?)[\s>]+a(?:[:[][^\s>]*)?$/.exec(trimmed);
        const target = descendant ? onAncestor : onSelf;
        const scope = descendant ? descendant[1] : trimmed;
        for (const [, cls] of scope.matchAll(/\.([a-zA-Z][\w-]*)/g)) target.add(cls);
      }
    }
  }
  return { onSelf, onAncestor };
}

/** A <p> whose entire content is one link. */
const PARAGRAPH_LINK = /<p(\s[^>]*)?>\s*(<(Link|a)\b[^>]*>)([\s\S]*?)<\/\3>\s*<\/p>/g;

const classesIn = (attrs) => (/className="([^"]*)"/.exec(attrs ?? '')?.[1] ?? '').split(/\s+/).filter(Boolean);

export function findUnmarked(cwd = '.') {
  const { onSelf, onAncestor } = coverage(cwd);
  const findings = [];
  for (const file of globSync('src/**/*.tsx', { cwd })) {
    const src = readFileSync(`${cwd}/${file}`, 'utf8');
    for (const m of src.matchAll(PARAGRAPH_LINK)) {
      const [, pAttrs, openTag, tag, inner] = m;
      // Text with an element inside it is a sentence, not a bare link.
      if (!inner.trim().startsWith('<') && inner.includes('<')) continue;
      if (/\bstandalone\b/.test(openTag)) continue;
      if (classesIn(pAttrs).some((c) => onAncestor.has(c))) continue;
      const classes = classesIn(openTag);
      if (classes.some((c) => c.endsWith('--block') || c === 'min-h-11' || onSelf.has(c))) continue;
      findings.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        tag,
        classes: classes.join(' ') || '(none)',
        text: inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 44),
      });
    }
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = findUnmarked();
  if (findings.length) {
    console.error(`\n${findings.length} link${findings.length === 1 ? ' is' : 's are'} the whole of a <p> with no ${MIN_TARGET_PX}px target:\n`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  <${f.tag} class="${f.classes}">  "${f.text}"`);
    console.error(`
Give it one: <Link standalone>, a \`--block\` modifier, or a class whose rule sets
min-height: ${MIN_TARGET_PX}px. A link INSIDE a sentence is exempt (WCAG 2.2 SC 2.5.8) and is
never matched by this check.
`);
    process.exit(2);
  }
  console.log(`standalone links: every <p> that is one link carries a ${MIN_TARGET_PX}px target.`);
}
