// Bundles the planner (the site's own TypeScript, untouched) into one file the eval provider can load.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'harness/answer.ts')],
  outfile: path.join(here, '.build/answer.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // PLANNER_SRC scores another copy of the planner (an earlier commit's `src`), for a like-for-like baseline.
  alias: { '@': process.env.PLANNER_SRC ? path.resolve(process.env.PLANNER_SRC) : path.join(here, '../../src') },
  loader: { '.json': 'json' },
  logLevel: 'warning',
});
