import { readFileSync } from 'node:fs';

/**
 * The names of every variable the server reads: the keys of `serverSchema` in src/lib/env.ts, plus
 * Vercel's Postgres aliases, which are read outside it. Parsed from the source rather than
 * imported, because env.ts validates `process.env` the moment it loads, and the callers here need
 * the names before that happens.
 */
export function serverEnvNames(root = new URL('../../', import.meta.url)) {
  const source = readFileSync(new URL('src/lib/env.ts', root), 'utf8');
  const schema = source.slice(source.indexOf('const serverSchema = z.object({'));
  const declared = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
  if (!declared.includes('DATABASE_URL')) throw new Error('server-env: could not read the variable names from src/lib/env.ts serverSchema');
  return [...declared, 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'];
}

/**
 * Drop every server variable from this process, so what runs next sees an unconfigured site: the
 * state a fresh clone, the test suites and CI are in. A developer's shell or an agent sandbox often
 * exports a live credential or a `DATABASE_URL`, and whatever inherited it resolved a live provider
 * (or a real database) on that machine only.
 */
export function dropServerEnv(env = process.env) {
  for (const name of serverEnvNames()) delete env[name];
  // Not a variable but a binary: an ffmpeg on PATH makes the video provider live. `off` says there
  // is none without looking (src/providers/video/ffmpeg.ts); a suite that wants one passes its own.
  env.FFMPEG_PATH = 'off';
}
