// Reads promptfoo's results and prints what a tuning step needs: pass rate and mean score by
// category, and the failing dev cases with their reasons. The held-out cases are only counted.
// `node report.mjs --log "what changed"` also appends the line to history.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./.results/latest.json', import.meta.url), 'utf8'));
const rows = data.results?.results ?? [];
const by = new Map();
for (const r of rows) {
  const cat = String(r.vars?.category ?? r.testCase?.vars?.category ?? 'other');
  const g = by.get(cat) ?? { n: 0, pass: 0, score: 0, fails: [] };
  g.n += 1;
  g.pass += r.success ? 1 : 0;
  g.score += r.score ?? 0;
  if (!r.success) g.fails.push(`${r.testCase?.description ?? r.vars?.request}\n      ${r.gradingResult?.reason ?? r.error ?? ''}`);
  by.set(cat, g);
}
const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const dev = [...by].filter(([c]) => c !== 'holdout');
const sum = (list) => list.reduce((t, [, g]) => ({ n: t.n + g.n, pass: t.pass + g.pass, score: t.score + g.score }), { n: 0, pass: 0, score: 0 });
const d = sum(dev);
const h = by.get('holdout') ?? { n: 0, pass: 0, score: 0 };
console.log('category     cases  pass   mean score');
for (const [c, g] of dev.sort()) console.log(`${c.padEnd(12)} ${String(g.n).padStart(5)}  ${pct(g.pass, g.n).padStart(6)} ${(g.score / g.n).toFixed(3).padStart(8)}`);
console.log(`${'dev'.padEnd(12)} ${String(d.n).padStart(5)}  ${pct(d.pass, d.n).padStart(6)} ${(d.score / Math.max(1, d.n)).toFixed(3).padStart(8)}`);
console.log(`${'holdout'.padEnd(12)} ${String(h.n).padStart(5)}  ${pct(h.pass, h.n).padStart(6)} ${(h.score / Math.max(1, h.n)).toFixed(3).padStart(8)}`);
if (!process.argv.includes('--quiet')) {
  for (const [c, g] of dev.sort()) for (const f of g.fails) console.log(`\n  [${c}] ${f}`);
}
const at = process.argv.indexOf('--log');
if (at > 0) {
  const line = { step: process.argv[at + 1] ?? '', dev: { cases: d.n, passed: d.pass, passRate: Number((d.pass / d.n).toFixed(4)), meanScore: Number((d.score / d.n).toFixed(4)) }, holdout: { cases: h.n, passed: h.pass, passRate: Number((h.pass / Math.max(1, h.n)).toFixed(4)), meanScore: Number((h.score / Math.max(1, h.n)).toFixed(4)) }, byCategory: Object.fromEntries(dev.map(([c, g]) => [c, Number((g.pass / g.n).toFixed(4))])) };
  appendFileSync(new URL('./history.jsonl', import.meta.url), JSON.stringify(line) + '\n');
}
