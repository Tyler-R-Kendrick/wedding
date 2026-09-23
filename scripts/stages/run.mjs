#!/usr/bin/env node
/**
 * Runs one npm script across the pipeline stages, in pipeline order.
 *
 *   node scripts/stages/run.mjs dev [stage…]        # all dev servers at once, output prefixed (ports 3101–3104)
 *   node scripts/stages/run.mjs build [stage…]      # static exports, one after another; stops at the first failure
 *   node scripts/stages/run.mjs typecheck [stage…]
 *   node scripts/stages/run.mjs start [stage…]      # serve each stage's out/ on its port
 *
 * With stage names (`sitemap`, `wireframe`, `skeleton`, `placeholder`) only those run. `dev` and
 * `start` are long-running and run in parallel; everything else runs in order, because a later
 * stage is only meaningful once the one it reads from is sound.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGES = [
  { id: 'sitemap', dir: 'stages/01-sitemap' },
  { id: 'wireframe', dir: 'stages/02-wireframe' },
  { id: 'skeleton', dir: 'stages/03-skeleton' },
  { id: 'placeholder', dir: 'stages/04-placeholder' },
];

const [script, ...only] = process.argv.slice(2);
if (!script) {
  console.error('usage: node scripts/stages/run.mjs <dev|build|typecheck|start> [stage…]');
  process.exit(2);
}
const unknown = only.filter((o) => !STAGES.some((s) => s.id === o));
if (unknown.length) {
  console.error(`unknown stage(s): ${unknown.join(', ')}. Known: ${STAGES.map((s) => s.id).join(', ')}`);
  process.exit(2);
}
const selected = only.length ? STAGES.filter((s) => only.includes(s.id)) : STAGES;
const parallel = script === 'dev' || script === 'start';

// NODE_OPTIONS from a parent shell (e.g. `--import tsx`) is not the stages' business.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
delete env.NODE_OPTIONS;

function run(stage) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], { cwd: path.join(ROOT, stage.dir), env, stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = `[${stage.id}] `;
    const pipe = (from, to) => {
      let buf = '';
      from.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) to.write(`${tag}${line}\n`);
      });
      from.on('end', () => buf && to.write(`${tag}${buf}\n`));
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

if (parallel) {
  const codes = await Promise.all(selected.map(run));
  process.exit(Math.max(...codes));
}
for (const stage of selected) {
  const code = await run(stage);
  if (code !== 0) {
    console.error(`\n${stage.id} failed (${script}); later stages were not run: they read from this one.`);
    process.exit(code);
  }
}
