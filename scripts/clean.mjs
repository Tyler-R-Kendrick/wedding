#!/usr/bin/env node
/**
 * `npm run clean`: put this checkout back to source plus node_modules.
 *
 * - Stops the Next servers this checkout started (dev, start, and Turbopack's worker pool). They are
 *   found by working directory in /proc, not by matching a command line, which would also match the
 *   shell running the search (scripts/agent/bash-guard.mjs says why). Other checkouts' servers and
 *   anything else on the machine are left alone. Skipped where there is no /proc (macOS).
 * - Removes build and test output: `.next` alone grew to 3.4 GB over a day of builds and dev
 *   sessions, which is most of what made a small site's checkout weigh 5 GB.
 *
 * `--data` also removes the local PGlite database (.data), which `npm run dev` rebuilds and seeds.
 */
import { existsSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = ['.next', 'test-results', 'playwright-report', 'coverage', 'demos/.out', 'demos/.webreel', 'demos/.webreel.local.json', '.impeccable/review', 'tsconfig.tsbuildinfo', 'stages/01-sitemap/.next', 'stages/02-wireframe/.next', 'stages/03-skeleton/.next', 'stages/04-placeholder/.next', 'stages/01-sitemap/out', 'stages/02-wireframe/out', 'stages/03-skeleton/out', 'stages/04-placeholder/out'];
if (process.argv.includes('--data')) OUTPUT.push('.data');

function ourServers() {
  if (!existsSync('/proc')) return [];
  const found = [];
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid)) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd !== ROOT && !cwd.startsWith(`${ROOT}${path.sep}`)) continue;
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
      if (/next-server|node_modules\/\.bin\/next (dev|start)|\bnext (dev|start)\b|\.next\/dev\/build\/chunks\/pool_entry/.test(cmd)) found.push({ pid: Number(pid), cmd: cmd.trim().slice(0, 80) });
    } catch {
      // gone, or not ours to read
    }
  }
  return found;
}

function sizeOf(p) {
  try {
    const s = statSync(p);
    if (!s.isDirectory()) return s.size;
    return readdirSync(p).reduce((n, e) => n + sizeOf(path.join(p, e)), 0);
  } catch {
    return 0;
  }
}

for (const { pid, cmd } of ourServers()) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`stopped ${pid}  ${cmd}`);
  } catch {
    // already exited
  }
}

let freed = 0;
for (const rel of OUTPUT) {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) continue;
  const bytes = sizeOf(p);
  rmSync(p, { recursive: true, force: true });
  freed += bytes;
  console.log(`removed ${rel} (${(bytes / 1e6).toFixed(0)} MB)`);
}
console.log(`clean: ${(freed / 1e9).toFixed(2)} GB freed`);
