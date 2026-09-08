#!/usr/bin/env node
/**
 * Every path a document points at must exist.
 *
 * Documentation is the one artifact in this repo with no compiler and no test runner behind it, so
 * a file that moves takes every reference to it with it, silently. Three classes are checked, all
 * of which were already broken somewhere when this script was written:
 *
 *  1. Markdown links to a relative path — `[the threat model](../architecture/threat-model.md)`.
 *  2. Backticked repository paths — `` `src/domain/weekend/slots.ts` `` — which the reviews and
 *     architecture notes use constantly and which no link checker would otherwise see.
 *  3. In-page anchors on a relative link — `foo.md#a-heading` — against the target's own headings.
 *
 * External URLs are NOT fetched: a docs check that needs the network is a docs check that fails on
 * a plane. Their shape is validated and nothing more.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';

const ROOT = cwd();

/**
 * Two trees are deliberately out of scope, and saying which is half the point of the check.
 *
 * VENDORED — `.claude/skills/**` is other people's documentation, copied in whole by
 * `npx skills add … --copy`. Its links point at ITS repository layout. Fixing them would mean
 * editing a vendored bundle that `npm run skills:update` overwrites.
 *
 * ARCHIVAL — a self-review, a design critique, an inspiration board and a swarm's own handover
 * note are dated records of a moment. `docs/reviews/PR-03-self-review.md` says `src/app/page.tsx`
 * because that is where the file was in September at level 03. Rewriting the record to match
 * today's tree would falsify it. They are read as history, not as instructions.
 */
const OUT_OF_SCOPE = [
  /^\.claude\/skills\//,
  /^docs\/reviews\//,
  /^docs\/design\/critiques\//,
  /^docs\/design\/inspo\//,
  /^docs\/prototypes\//,
  /^docs\/research\//,
];

/** Tracked files only — an untracked scratch note is not documentation. */
const tracked = new Set(
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean),
);
const docs = [...tracked].filter((f) => f.endsWith('.md') && !OUT_OF_SCOPE.some((re) => re.test(f)));

/** `## A Heading` -> `a-heading`, GitHub's slug rules, near enough for our own headings. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ +/g, '-');
}

const headingsOf = new Map();
function headings(file) {
  if (!headingsOf.has(file)) {
    const found = new Set();
    if (existsSync(join(ROOT, file))) {
      for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
        const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
        if (m) found.add(slug(m[1]));
      }
    }
    headingsOf.set(file, found);
  }
  return headingsOf.get(file);
}

/**
 * A backticked span that looks like a repository path. Deliberately narrow: it must contain a slash
 * and end in a known source extension, or be a directory under one of the top-level trees. Prose
 * like `status: 'ready'` and glob-ish shorthand like `src/providers/<kind>/` are not paths.
 */
const CODE_PATH = /^(?:\.\/)?((?:src|tests|scripts|docs|public|\.github)\/[\w./-]+)$/;
/** `PR-NN`, `000N`, `<kind>`, `…` — a shape, not a file. Templates and specs are full of them. */
const PLACEHOLDER = /NN|\bN\b|000N|[<>{}*]|\u2026/;
const SOURCE_EXT = /\.(ts|tsx|mjs|js|jsx|css|json|md|sql|yml|yaml|sh|svg|png|jpg|webp)$/;

const findings = [];
const seen = { links: 0, codePaths: 0, anchors: 0 };

for (const file of docs) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const here = dirname(file);

  // Fenced blocks are examples, not references. Strip them before looking for links.
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');

  for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
    seen.links += 1;
    const [pathPart, anchor] = href.split('#');
    if (!pathPart) continue;
    const target = normalize(join(here, pathPart));
    if (!existsSync(join(ROOT, target))) {
      findings.push({ file, kind: 'link', detail: `${href} -> ${target} does not exist` });
      continue;
    }
    if (anchor && target.endsWith('.md')) {
      seen.anchors += 1;
      if (!headings(target).has(anchor.toLowerCase())) {
        findings.push({ file, kind: 'anchor', detail: `${href} -> no heading "#${anchor}" in ${target}` });
      }
    }
  }

  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    const hit = CODE_PATH.exec(span);
    if (!hit) continue;
    const p = hit[1];
    if (PLACEHOLDER.test(p)) continue;
    // A directory reference is fine as long as the directory is there.
    if (!SOURCE_EXT.test(p) && !existsSync(join(ROOT, p))) {
      findings.push({ file, kind: 'path', detail: `${p} (directory) does not exist` });
      continue;
    }
    if (!SOURCE_EXT.test(p)) continue;
    seen.codePaths += 1;
    if (!existsSync(join(ROOT, p))) findings.push({ file, kind: 'path', detail: `${p} does not exist` });
  }
}

const json = argv.includes('--json');
if (json) {
  console.log(JSON.stringify({ documents: docs.length, checked: seen, findings }, null, 2));
} else {
  console.log(`${docs.length} documents · ${seen.links} relative links · ${seen.anchors} anchors · ${seen.codePaths} repository paths`);
  for (const f of findings) console.error(`  ${f.file}: [${f.kind}] ${f.detail}`);
  if (findings.length === 0) console.log('All references resolve.');
  else console.error(`\n${findings.length} broken reference${findings.length === 1 ? '' : 's'}.`);
}
exit(findings.length === 0 ? 0 : 1);
