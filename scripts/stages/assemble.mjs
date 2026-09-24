#!/usr/bin/env node
/**
 * Assembles the design pipeline's stages into the wedding app, which serves them
 * (src/lib/stage-hosting.ts):
 *
 *   npm run stages:assemble                      # both variants → public/_stages/  (local, CI)
 *   npm run stages:assemble -- --for-vercel      # what the Vercel build runs: the variant this
 *                                                # environment serves (production: subdomains,
 *                                                # previews: paths)
 *   npm run stages:assemble -- --only skeleton   # rebuild one stage (the hub is always rewritten)
 *
 *   public/_stages/
 *     _hosts/<stage>/   built at a host root, for <stage>.dev.kendrick.wedding
 *     <stage>/          built under /<stage>, for <preview host>/<stage>/…
 *     _hub/             the hub and board (scripts/stages/hub.ts)
 *
 * Then `npm run dev` (or `next build`) serves them: http://sitemap.dev.kendrick.localhost:3000,
 * http://dev.kendrick.localhost:3000, http://localhost:3000/sitemap.
 *
 * A stage's two variants build one after the other (they share its .next); different stages
 * build side by side, STAGES_CONCURRENCY at a time (default 2). A failed build stops everything:
 * no half-assembled pipeline is ever served.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'public/_stages');
const STAGES = [
  { id: 'sitemap', dir: 'stages/01-sitemap' },
  { id: 'wireframe', dir: 'stages/02-wireframe' },
  { id: 'skeleton', dir: 'stages/03-skeleton' },
  { id: 'placeholder', dir: 'stages/04-placeholder' },
];

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args.slice(onlyAt + 1) : [];
const selected = only.length ? STAGES.filter((s) => only.includes(s.id)) : STAGES;
const forVercel = args.includes('--for-vercel');
const production = process.env.VERCEL_ENV === 'production';
const variants = forVercel ? (production ? ['host'] : ['path']) : ['host', 'path'];
const concurrency = Math.max(1, Number(process.env.STAGES_CONCURRENCY ?? 2));

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
delete env.NODE_OPTIONS;
/**
 * Where the subdomain builds are served. Baked into their HTML so the stage bar's links are right
 * before any script runs (stages/01-sitemap/lib/pipeline.ts). STAGES_DEV_DOMAIN is set by vercel.json;
 * locally it is http://dev.kendrick.localhost:3000: production's shape (kendrick.wedding) on this
 * machine. Browsers resolve every *.localhost here and treat it as secure over http, and
 * kendrick.localhost with its subdomains is one site (dev.localhost and localhost are two).
 */
const devDomain = process.env.STAGES_DEV_DOMAIN?.replace(/\/$/, '');
const devOrigin = devDomain ? `https://${devDomain}` : 'http://dev.kendrick.localhost:3000';

function build(stage, variant) {
  const basePath = variant === 'path' ? `/${stage.id}` : '';
  const label = `${stage.id} (${variant === 'path' ? `${basePath}/…` : 'host root'})`;
  return new Promise((resolve, reject) => {
    const vars = variant === 'path' ? { NEXT_PUBLIC_BASE_PATH: basePath } : { NEXT_PUBLIC_BASE_PATH: '', NEXT_PUBLIC_STAGES_DEV_ORIGIN: devOrigin };
    const child = spawn('npm', ['run', 'build'], { cwd: path.join(ROOT, stage.dir), env: { ...env, ...vars }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (c) => (log += c));
    child.stderr.on('data', (c) => (log += c));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${label} failed:\n${log}`));
      const to = variant === 'path' ? path.join(DIST, stage.id) : path.join(DIST, '_hosts', stage.id);
      rmSync(to, { recursive: true, force: true });
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(path.join(ROOT, stage.dir, 'out'), to, { recursive: true });
      console.log(`✓ ${label}`);
      resolve();
    });
  });
}

/** Both variants of one stage, in turn. */
const buildStage = async (stage) => {
  for (const v of variants) await build(stage, v);
};

if (!only.length) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
console.log(`assembling ${selected.map((s) => s.id).join(', ')} (${variants.join(' + ')}), ${concurrency} at a time → ${path.relative(ROOT, DIST)}/`);

const queue = [...selected];
try {
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await buildStage(queue.shift());
    }),
  );
} catch (err) {
  console.error(`\nassemble: ${err.message}`);
  process.exit(1);
}

// The hub reads the sitemap, the wireframes and the sign-offs as TypeScript, through tsx. Where the
// path builds exist (previews, local), its links are paths: they work on that same host, and its
// script moves them to the subdomains on dev.*. Only a build without them (production) links
// straight to the subdomains; a preview's hub must link to that preview, not to production.
const hubEnv = { ...env };
if (variants.includes('path')) delete hubEnv.STAGES_DEV_DOMAIN;
const hub = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts/stages/hub.ts'), DIST], { cwd: ROOT, env: hubEnv, stdio: 'inherit' });
if (hub.status !== 0) process.exit(hub.status ?? 1);

const expected = STAGES.flatMap((s) => variants.map((v) => (v === 'path' ? path.join(DIST, s.id, 'index.html') : path.join(DIST, '_hosts', s.id, 'index.html'))));
const missing = expected.filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`assemble: missing ${missing.map((f) => path.relative(ROOT, f)).join(', ')}; run without --only first.`);
  process.exit(1);
}
console.log(`assembled ${path.relative(ROOT, DIST)}/.`);
