import { describe, expect, it } from 'vitest';
import { isNextServer, parseStat } from '../../../scripts/clean.mjs';

describe('npm run clean: which processes are Next servers', () => {
  it('recognises every process a dev or production server runs as', () => {
    for (const argv of [
      ['next-server (v16.3.4)'],
      ['node', '/home/user/wedding/node_modules/.bin/next', 'dev', '-p', '3000'],
      ['node', '/home/user/wedding/node_modules/next/dist/bin/next', 'start'],
      ['node', '/home/user/wedding/.next/dev/build/chunks/pool_entry-[turbopack-node]_transforms_postcss_ts_0tp-k2v._.js', '44889'],
      ['sh', '-c', 'next dev -p 3007'],
    ]) {
      expect(isNextServer(argv), argv.join(' ')).toBe(true);
    }
  });

  it('leaves alone a shell whose command merely mentions a server, which is how it once killed its caller', () => {
    for (const argv of [
      ['/bin/bash', '-c', 'npm run clean; pgrep -x next-server || echo "no next server"'],
      ['/bin/bash', '-c', 'PGLITE_MEMORY=1 npm run dev -- -p 3006 & timeout 90 node scripts/clean.mjs'],
      ['sh', '-c', 'echo next dev'],
      ['node', '/root/.npm/_npx/cbf1b8a072280925/node_modules/.bin/playwright-mcp', '--browser', 'chromium'],
      ['node', '/home/user/wedding/node_modules/.bin/next', 'build'],
      ['/opt/claude-code/bin/claude', '--output-format=stream-json'],
      [],
    ]) {
      expect(isNextServer(argv), argv.join(' ')).toBe(false);
    }
  });

  it('reads state and parent from /proc stat, whatever the process named itself', () => {
    expect(parseStat('2434 (next-server (v1) S 2422 2421 2421 0 -1')).toEqual({ state: 'S', ppid: 2422 });
    // A stopped server that nobody has reaped yet is gone, not running: clean must not wait on it.
    expect(parseStat('2421 (sh) Z 1 2421 2421 0 -1').state).toBe('Z');
  });
});
