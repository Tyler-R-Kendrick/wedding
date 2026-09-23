#!/usr/bin/env node
/**
 * Proves the wedding app serves the pipeline's stages at every address it promises
 * (src/lib/stage-hosting.ts), against a running app: `next dev`, or `next start` as CI does.
 *
 *   npm run stages:assemble && npm run dev &  npm run stages:probe     # http://127.0.0.1:3000
 *   npm run stages:probe -- <origin> [dev domain]
 *
 * For the hub, each stage by subdomain and each stage by path, it checks:
 *   - the page answers 200, and is the page it should be, with links that work before any script;
 *   - every script and stylesheet the page references also answers 200 at that same address,
 *     which is what fails if a basePath or a rewrite is wrong;
 *   - the stage 4 fonts load;
 *   - nothing else answers: the hub host's other paths, /_stages/ itself and unknown stage pages 404.
 * Exits 1 listing every failure.
 */
import http from 'node:http';
import https from 'node:https';

const origin = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
// The dev domain the subdomain builds were assembled for (scripts/stages/assemble.mjs).
const domain = process.argv[3] ?? 'dev.kendrick.localhost';
const STAGES = [
  { id: 'sitemap', n: 1 },
  { id: 'wireframe', n: 2 },
  { id: 'skeleton', n: 3 },
  { id: 'placeholder', n: 4 },
];
const failures = [];
let checks = 0;

/** node:http rather than fetch: fetch drops a Host header, and Host is the whole point here. */
function get(host, path) {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { headers: { host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, location: res.headers.location ?? null }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function expectPage(label, host, path, marker) {
  checks++;
  const r = await get(host, path);
  if (r.status !== 200) return void failures.push(`${label}: ${host}${path} → ${r.status}`);
  if (!r.body.includes(marker)) return void failures.push(`${label}: ${host}${path} is not the expected page (no "${marker}")`);
  const assets = [...r.body.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  if (!assets.length && marker.includes('</title>')) failures.push(`${label}: ${host}${path} references no scripts at all`);
  for (const asset of new Set(assets)) {
    checks++;
    const a = await get(host, asset);
    if (a.status !== 200) {
      failures.push(`${label}: asset ${host}${asset} → ${a.status}`);
      continue;
    }
    // Fonts and ornament a stylesheet points at are where a missing path prefix shows up.
    for (const ref of new Set([...a.body.matchAll(/url\(["']?(\/[^"')]+)/g)].map((m) => m[1]))) {
      checks++;
      const f = await get(host, ref);
      if (f.status !== 200) failures.push(`${label}: ${asset} → url(${ref}) at ${host} → ${f.status}`);
    }
  }
  return r.body;
}

await expectPage('hub by host', domain, '/', 'in five fidelities');
const hubByPath = await expectPage('hub by path', 'localhost', '/stages', 'in five fidelities');
// Where the path builds exist, the hub links to them on the same host: a preview's hub must not
// send anyone to production's subdomains.
checks++;
if (hubByPath && (!hubByPath.includes('href="/skeleton/rsvp"') || /href="https:\/\/[a-z]+\.dev\./.test(hubByPath))) failures.push('hub by path: links are not paths on this host');

// Only the promised addresses serve anything. Each of these must be a 404:
for (const [host, path, why] of [
  [domain, '/rsvp', 'the hub host is the hub alone, never the wedding app under a second name'],
  [domain, '/api/auth/get-session', 'nor its API'],
  ['localhost', '/_stages/_hub/index.html', 'the assembled files are never served directly'],
  ['localhost', '/_stages/_hosts/sitemap/rsvp.html', 'the assembled files are never served directly'],
  [`sitemap.${domain}`, '/no-such-page', 'a stage has only the sitemap\'s pages'],
]) {
  checks++;
  const r = await get(host, path);
  if (r.status !== 404) failures.push(`${host}${path} → ${r.status}, expected 404 (${why})`);
}
// The wedding site's own home page is untouched: the hub lives only on dev.* and /stages.
checks++;
const home = await get('localhost', '/');
if (home.status >= 400 || home.body.includes('in five fidelities')) failures.push(`the app's own / at localhost → ${home.status}${home.body.includes('in five fidelities') ? ' (serves the hub!)' : ''}`);
checks++;
const slash = await get(`sitemap.${domain}`, '/rsvp/');
if (slash.status !== 308 || slash.location !== '/rsvp') failures.push(`trailing slash: sitemap.${domain}/rsvp/ → ${slash.status} ${slash.location}`);

for (const s of STAGES) {
  // The static HTML, before any script runs: its stage bar must already link to the subdomains,
  // not to the dev ports (localhost:3101…) a bare `npm run dev:<stage>` uses.
  const bare = await expectPage(`${s.id} by subdomain`, `${s.id}.${domain}`, '/rsvp', `Stage ${s.n}</title>`);
  checks++;
  if (bare && (/localhost:310\d/.test(bare) || !bare.includes(`//wireframe.${domain}`))) failures.push(`${s.id} by subdomain: its server-rendered stage bar does not link to the stage subdomains`);
  await expectPage(`${s.id} by subdomain`, `${s.id}.${domain}`, '/', `Stage ${s.n}</title>`);
  await expectPage(`${s.id} by subdomain`, `${s.id}.${domain}`, '/our-adventures/example', `Stage ${s.n}</title>`);
  await expectPage(`${s.id} by path`, 'localhost', `/${s.id}`, `Stage ${s.n}</title>`);
  await expectPage(`${s.id} by path`, 'localhost', `/${s.id}/rsvp`, `Stage ${s.n}</title>`);
  await expectPage(`${s.id} by path`, 'localhost', `/${s.id}/our-adventures/example`, `Stage ${s.n}</title>`);
}

// Stage 4 wears the real designs: their fonts must load by both addresses.
for (const [host, prefix] of [[`placeholder.${domain}`, ''], ['localhost', '/placeholder']]) {
  checks++;
  const r = await get(host, `${prefix}/fonts/botanical-deco/bodoni-moda-wght.woff2`);
  if (r.status !== 200) failures.push(`placeholder font at ${host}${prefix}/fonts/… → ${r.status}`);
}

if (failures.length) {
  console.error(`stage hosting probe: ${failures.length} of ${checks} checks failed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`stage hosting probe: all ${checks} checks passed (hub, 4 stages × subdomain + path, their assets, stage 4 fonts, the 404s, the app's own home untouched).`);
