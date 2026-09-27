#!/usr/bin/env node
/**
 * `npm run clean`: put this checkout back to source plus node_modules.
 *
 * - Stops the Next servers this checkout started (dev, start, and Turbopack's worker pool), and waits
 *   for them to exit. They are found by working directory in /proc and recognised by their argument
 *   vector, never by searching a command line, which also matches any shell whose command mentions
 *   a server (scripts/agent/bash-guard.mjs says why). This process and its ancestors are never
 *   candidates. Other checkouts' servers and anything else on the machine are left alone. Skipped
 *   where there is no /proc (macOS).
 * - Removes build and test output: `.next` alone grew to 3.4 GB over a day of builds and dev
 *   sessions, which is most of what made a small site's checkout weigh 5 GB.
 *
 * `--data` also removes the local PGlite database (.data), which `npm run dev` rebuilds and seeds.
 */
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = ['.next', 'test-results', 'playwright-report', 'coverage', 'demos/.out', 'demos/.webreel', 'demos/.webreel.local.json', '.impeccable/review', 'tsconfig.tsbuildinfo', 'stages/01-sitemap/.next', 'stages/02-wireframe/.next', 'stages/03-skeleton/.next', 'stages/04-placeholder/.next', 'stages/01-sitemap/out', 'stages/02-wireframe/out', 'stages/03-skeleton/out', 'stages/04-placeholder/out'];
if (process.argv.includes('--data')) OUTPUT.push('.data');

/** The argument vector of a process, as it was started (or as it renamed itself: `next-server (v…)`). */
function argvOf(pid) {
  return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
}

/** This process and every process above it: never ours to stop, whatever they were started with. */
function ancestry() {
  const chain = new Set();
  for (let pid = process.pid; pid > 1 && !chain.has(pid); ) {
    chain.add(pid);
    try {
      pid = parseStat(readFileSync(`/proc/${pid}/stat`, 'utf8')).ppid;
    } catch {
      break;
    }
  }
  return chain;
}

/**
 * A Next server is recognised by what it runs, argument by argument, never by searching the whole
 * command line. The search used to be one regex over the joined command line, and `next-server`
 * matched anywhere in it: a shell in this checkout whose command merely mentioned it (an agent's
 * `pgrep -x next-server`, say) was "a server" and got a SIGTERM. That is how this script killed
 * the shell that ran it.
 */
export function isNextServer(argv) {
  const [exe = '', first = '', second = ''] = argv;
  if (exe.startsWith('next-server')) return true; // the server renames itself `next-server (v16…)`
  const program = path.basename(exe);
  if (program === 'node') {
    if (/\/node_modules\/\.bin\/next$|\/next\/dist\/bin\/next$/.test(first) && (second === 'dev' || second === 'start')) return true;
    if (first.includes(`${path.sep}.next${path.sep}`) && path.basename(first).startsWith('pool_entry')) return true; // Turbopack workers
  }
  // npm runs the script through `sh -c "next dev …"`; that shell is the server's parent.
  return (program === 'sh' || program === 'bash') && first === '-c' && /^next (dev|start)(\s|$)/.test(second);
}

function ourServers() {
  if (!existsSync('/proc')) return [];
  const skip = ancestry();
  const found = [];
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d) && !skip.has(Number(d)))) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd !== ROOT && !cwd.startsWith(`${ROOT}${path.sep}`)) continue;
      const argv = argvOf(pid);
      if (isNextServer(argv)) found.push({ pid: Number(pid), cmd: argv.join(' ').slice(0, 80) });
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

/**
 * State and parent from `/proc/<pid>/stat`: "pid (comm) state ppid …". The name may itself hold
 * spaces and parentheses (`next-server (v16.3.4)` becomes `(next-server (v1)`), so read after the last ')'.
 */
export function parseStat(stat) {
  const [state, ppid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { state, ppid: Number(ppid) };
}

/** Running, rather than gone or a zombie: a zombie has exited and only waits to be reaped (state Z). */
const alive = (pid) => {
  try {
    return parseStat(readFileSync(`/proc/${pid}/stat`, 'utf8')).state !== 'Z';
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops them and waits until they are gone. A SIGTERM is a request, not an exit: a dev server that
 * has compiled dozens of routes spends seconds flushing Turbopack's cache into `.next` as it goes.
 * Deleting `.next` under it met a directory that kept refilling, `rmSync` threw ENOTEMPTY, and the
 * script died with a bare stack trace and nothing removed.
 */
async function stopServers() {
  const servers = ourServers();
  for (const { pid, cmd } of servers) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`stopped ${pid}  ${cmd}`);
    } catch {
      // already exited
    }
  }
  for (const [signal, waitMs] of [[null, 10_000], ['SIGKILL', 5_000]]) {
    const left = servers.filter(({ pid }) => alive(pid));
    if (!left.length) return;
    for (const { pid } of signal ? left : []) {
      try {
        process.kill(pid, signal);
        console.log(`killed ${pid} (still running after SIGTERM)`);
      } catch {
        // exited in between
      }
    }
    for (const deadline = Date.now() + waitMs; Date.now() < deadline && left.some(({ pid }) => alive(pid)); ) await sleep(100);
  }
}

// Node resolves symlinks in the main module's URL but not in argv[1], so compare real paths: a
// checkout reached through a symlink would otherwise skip everything and still exit 0.
const runDirectly = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (runDirectly()) {
  await stopServers();

  let freed = 0;
  for (const rel of OUTPUT) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) continue;
    const bytes = sizeOf(p);
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      // Something outside this checkout's servers is still writing here. Say which path, keep going.
      console.error(`could not remove ${rel}: ${e.code ?? e.message}`);
      process.exitCode = 1;
      continue;
    }
    freed += bytes;
    console.log(`removed ${rel} (${(bytes / 1e6).toFixed(0)} MB)`);
  }
  console.log(`clean: ${(freed / 1e9).toFixed(2)} GB freed`);
}
