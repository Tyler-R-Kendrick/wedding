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
 *     44px or more contributes its classes. Rename a class or drop one out of a touch-target rule
 *     and this gate moves with it, instead of trusting a list that rots.
 *
 * A class earns its place two ways, and telling them apart is the whole of `coverage`:
 *
 *   onSelf      A rule whose selector is ONE compound — `.link-block { min-height: 44px }`. The
 *               class carries the geometry wherever it appears, so the anchor wearing it is done.
 *   onAncestor  A rule with a combinator — `.wp-brand a`, `.gh-back .gh-link`,
 *               `.gh-why p > .gh-link`. The LEADING classes are what make the rule apply; the
 *               anchor is sized only inside them, and only if it IS the thing the rule sizes.
 *               So onAncestor maps each leading class to the rule's final compound, and a scope
 *               accepts a link only when that compound could match it. `.wp-why summary` sizes a
 *               `<summary>` and can never size an anchor, so `wp-why` shelters nothing — before
 *               this, it sheltered every link under a `<details class="wp-why">`, including one
 *               of the thirteen this very change had to fix.
 *
 * Reading a scoped rule as if its last compound covered on its own is how the first version of
 * this gate let every kit link through. `.gh-entry__title .gh-link` and nine rules like it put
 * `gh-link` in onSelf — and `<Link>` in both kits always emits `gh-link` or `cv-link` — so a bare
 * `<p><a className="gh-link">…</a></p>` anywhere outside those scopes would have been accepted at
 * whatever height the line box gave it. Nothing in the tree had that shape, so the gate was green
 * and wrong rather than red and wrong; the hole is closed before something grows into it.
 *
 * The cost of closing it is that a scope now has to be VISIBLE. Six paragraph links are covered
 * this way and the scope sits 0, 0, 3, 3, 5 and 5 lines above them, so `SCOPE_LINES` looks back
 * 12 — twice the worst case. Beyond that window the gate reports the link and someone looks, which
 * is the direction a check should fail in.
 */
import { readFileSync, globSync } from 'node:fs';

const MIN_TARGET_PX = 44;
const ROOT_FONT_PX = 17; // `html { font-size: 17px }` — the rem ramp is built on it.
const SCOPE_LINES = 12; // How far above a <p> an ancestor's className may sit. Measured: worst is 5.

const CLASSES_IN_SELECTOR = /\.([a-zA-Z][\w-]*)/g;

/**
 * Split on the characters in `at`, but only where parentheses and brackets are balanced. A plain
 * `split(',')` cuts `:is(p, td) a` into `:is(p` and `td) a`, and a plain split on whitespace cuts
 * it again — after which `.foo:not(.bar)` donates `bar` as if a rule named it. No rule in this
 * tree has both a functional pseudo-class and a 44px min-height, but `.ops :is(p, td, dd, li,
 * figcaption) a` exists and is exactly where someone would add one.
 */
function splitOutside(text, at) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && at.test(ch)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Split a selector on its combinators: `.gh-why p > .gh-link` -> ['.gh-why', 'p', '.gh-link']. */
const compoundsOf = (selector) => splitOutside(selector, /[\s>+~]/);

/** A compound without its pseudo-class arguments, so `:not(.bar)` cannot donate `bar`. */
const bare = (compound) => compound.replace(/\([^()]*\)/g, '');

/** The element name a compound names, if it names one: `.gh-link` -> null, `a:hover` -> 'a'. */
const elementOf = (compound) => /^([a-zA-Z][\w-]*)/.exec(bare(compound))?.[1] ?? null;

/** `a`, `a:hover` and `.gh-link` can all be an anchor; `summary` and `input` cannot. */
const subjectCouldBeAnchor = (compound) => {
  const element = elementOf(compound);
  return element === null || element === 'a';
};

/** Does the rule this compound ends actually size THIS anchor? */
const subjectMatches = (compound, classes) => {
  if (!subjectCouldBeAnchor(compound)) return false;
  const wanted = [...bare(compound).matchAll(CLASSES_IN_SELECTOR)].map(([, cls]) => cls);
  return wanted.every((cls) => classes.includes(cls));
};

export function coverage(cwd = '.') {
  const onSelf = new Set();
  /** class -> the final compounds of the rules it scopes, e.g. 'gh-back' -> Set{'.gh-link'}. */
  const onAncestor = new Map();
  for (const file of globSync('src/**/*.css', { cwd })) {
    // Comments first: a rule preceded by `/* … scripts/x.mjs … */` otherwise donates `mjs`.
    const css = readFileSync(`${cwd}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const min = /min-height:\s*(\d+(?:\.\d+)?)(px|rem)/.exec(body);
      if (!min) continue;
      const px = min[2] === 'rem' ? parseFloat(min[1]) * ROOT_FONT_PX : parseFloat(min[1]);
      if (px < MIN_TARGET_PX) continue;
      for (const trimmed of splitOutside(selectors, /,/)) {
        if (trimmed.startsWith('@')) continue;
        const compounds = compoundsOf(trimmed);
        const subject = compounds[compounds.length - 1];
        if (compounds.length === 1) {
          for (const [, cls] of bare(subject).matchAll(CLASSES_IN_SELECTOR)) onSelf.add(cls);
          continue;
        }
        // A rule whose subject is some other element can never size an anchor. Eight rules in this
        // tree are that shape (`.wp-why summary`, `.wp-field input`, `.media-field textarea`, …).
        if (!subjectCouldBeAnchor(subject)) continue;
        for (const compound of compounds.slice(0, -1)) {
          for (const [, cls] of bare(compound).matchAll(CLASSES_IN_SELECTOR)) {
            if (!onAncestor.has(cls)) onAncestor.set(cls, new Set());
            onAncestor.get(cls).add(subject);
          }
        }
      }
    }
  }
  return { onSelf, onAncestor };
}

/**
 * A <p> whose entire content is one link.
 *
 * The body cannot cross a paragraph boundary. An untempered `[\s\S]*?` backtracks past its own
 * `</p>` to the next `</a></p>` anywhere in the file, and `matchAll` then resumes AFTER that
 * region — so a standalone link sitting below a `<p><a>…</a> trailing prose</p>` was never tested.
 * Two such runaways are live in the theme kits' photos recipes (21 and 15 lines).
 */
const PARAGRAPH_LINK = /<p(\s[^>]*)?>\s*(<(Link|a)\b[^>]*>)((?:(?!<\/p>|<p[\s>])[\s\S])*?)<\/\3>\s*<\/p>/g;

/**
 * `standalone` or `standalone={true}` and nothing else. `\bstandalone\b` alone also matched
 * `standalone={false}` and `standalone={isWide}`, which is an opt-out from a rule whose reason for
 * existing is that call sites opt out by accident.
 */
const MARKED_STANDALONE = /\bstandalone(?![\w-])(?!\s*=)|\bstandalone\s*=\s*\{\s*true\s*\}/;

const classesIn = (attrs) => (/className="([^"]*)"/.exec(attrs ?? '')?.[1] ?? '').split(/\s+/).filter(Boolean);

/** Every class named in a `className="…"` on the <p> itself or in the SCOPE_LINES above it. */
function scopeClasses(lines, line, pAttrs) {
  const near = new Set(classesIn(pAttrs));
  for (const text of lines.slice(Math.max(0, line - 1 - SCOPE_LINES), line - 1)) {
    for (const [, value] of text.matchAll(/className="([^"]*)"/g)) {
      for (const cls of value.split(/\s+/)) if (cls) near.add(cls);
    }
  }
  return near;
}

export function findUnmarked(cwd = '.') {
  const { onSelf, onAncestor } = coverage(cwd);
  const findings = [];
  for (const file of globSync('src/**/*.tsx', { cwd })) {
    const src = readFileSync(`${cwd}/${file}`, 'utf8');
    const lines = src.split('\n');
    for (const m of src.matchAll(PARAGRAPH_LINK)) {
      const [, pAttrs, openTag, tag, inner] = m;
      // The one thing the body can still hold that makes this a sentence is a SECOND link: the
      // lazy match spans `<a>Chicago</a> or <a>Evanston</a>`, and giving those block geometry
      // would break the line (SC 2.5.8 exempts a link inside a sentence).
      //
      // The old test — any element inside a body that does not start with one — read a label's
      // own markup as prose. `<a>{venue.address}<span className="sr-only"> (opens in Google Maps,
      // new tab)</span></a>` is one link and nothing else, and a visually-hidden suffix is not a
      // sentence. Four live links on /travel were exempted that way, each measuring 17px.
      if (inner.includes(`</${tag}>`)) continue;
      if (MARKED_STANDALONE.test(openTag)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const classes = classesIn(openTag);
      if (classes.some((c) => c === 'min-h-11' || onSelf.has(c))) continue;
      const scoped = [...scopeClasses(lines, line, pAttrs)].flatMap((c) => [...(onAncestor.get(c) ?? [])]);
      if (scoped.some((compound) => subjectMatches(compound, classes))) continue;
      findings.push({
        file,
        line,
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
Give it one: <Link standalone>, a class whose own rule sets min-height: ${MIN_TARGET_PX}px, or a
scope that sizes anchors — whose className must be on the <p> or within ${SCOPE_LINES} lines above
it. A class ending \`--block\` is not enough on its own; it needs the rule. A link INSIDE a sentence
is exempt (WCAG 2.2 SC 2.5.8) and is never matched by this check.
`);
    process.exit(2);
  }
  console.log(`standalone links: every <p> that is one link carries a ${MIN_TARGET_PX}px target.`);
}
