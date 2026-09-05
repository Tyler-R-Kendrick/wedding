#!/usr/bin/env node
// Openverse (https://openverse.org) image search and download, sharing the license ledger with
// scripts/fetch-commons.mjs (public/assets/attributions.json + public/assets/ATTRIBUTIONS.md).
//
//   export -n NODE_OPTIONS; NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs "fern pressed specimen"
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs "art deco sunburst brass" --license cc0,pdm --page-size 10
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs --download <identifier> --use "Conservatory — pressed-fern card texture"
//   Options: --license cc0,pdm,by   licenses to search (default). Only cc0, pdm, by, by-sa are ever passed through.
//            --page-size 20 --page 1 --source wikimedia,flickr,…   paging and provider filter
//            --json                 print the raw API results instead of the table
//            --download <id>        fetch one result by identifier into public/assets/commons/openverse-<id>.<ext>
//            --allow-by             let --download accept CC BY / CC BY-SA (attribution is then required and recorded);
//                                   default is cc0 / pdm only, because those need no credit line on the page
//            --use "<text>"         intended use recorded in the ledger (default: a TODO for the couple)
//            --out <dir>            download directory (default public/assets/commons)
//            --dry-run              resolve and license-check only; write nothing
//
// Network: outbound HTTPS in this sandbox goes through a proxy. Node's built-in fetch only honours
// HTTPS_PROXY when NODE_USE_ENV_PROXY=1 is set, so run as `NODE_USE_ENV_PROXY=1 node scripts/…`.
// Hosts contacted: api.openverse.org, and for --download the provider's file host that Openverse
// reports in `url` (upload.wikimedia.org, live.staticflickr.com, …). Never venue or vendor sites.
//
// Auth: anonymous use is allowed (observed 2026-09-05: 20 requests/min burst, 200/day per IP). If
// OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET are set, a client-credentials token is requested
// per run (https://api.openverse.org/v1/#tag/auth) and never written to disk.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTRIBUTIONS_MD_PATH, DEFAULT_OUT, LEDGER_PATH, REPO_ROOT, USER_AGENT,
  attributionString, classifyLicense, downloadImage, extForMime, loadLedger, saveLedger, sha256, toPosix, upsertAsset, writeAttributions,
} from './fetch-commons.mjs';

const API = 'https://api.openverse.org/v1';
const SEARCHABLE_LICENSES = ['cc0', 'pdm', 'by', 'by-sa'];

async function getToken() {
  const id = process.env.OPENVERSE_CLIENT_ID, secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const res = await fetch(`${API}/auth_tokens/token/`, {
      method: 'POST',
      headers: { 'user-agent': USER_AGENT, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.warn(`Openverse auth failed (HTTP ${res.status}); continuing anonymously`); return null; }
    return (await res.json()).access_token || null;
  } catch (e) {
    console.warn(`Openverse auth error (${e.message}); continuing anonymously`);
    return null;
  }
}

function rateLimitLine(headers) {
  const pairs = [];
  for (const [k, v] of headers) if (/^x-ratelimit-available-/i.test(k)) pairs.push(`${k.replace(/^x-ratelimit-available-/i, '')} ${v} left of ${headers.get(k.replace('available', 'limit')) || '?'}`);
  return pairs.join('; ');
}

async function api(path, params = {}, token = null) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new Error(`api.openverse.org unreachable (${e.cause?.code || e.name}: ${e.message}) — if the proxy refuses the host you will see 403/407 above`);
  }
  const text = await res.text();
  if (res.status === 429) throw new Error(`Openverse rate limit hit (HTTP 429, retry-after ${res.headers.get('retry-after') || '?'}s). ${rateLimitLine(res.headers)}`);
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(`Openverse search backend unavailable (HTTP ${res.status}) — the host is reachable but the search index timed out; retry later`);
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Openverse returned non-JSON (${res.headers.get('content-type')}): ${text.slice(0, 120)}`); }
  return { json, rate: rateLimitLine(res.headers) };
}

const licenseOf = (r) => classifyLicense({ code: r.license, version: r.license_version, url: r.license_url });
const shortLicense = (r) => { const l = licenseOf(r); return l.ok ? l.shortName : `${r.license || '?'} ${r.license_version || ''} (refused)`; };

function printResults(json, licenses) {
  const results = json.results ?? [];
  console.log(`${json.result_count ?? results.length} result(s), page ${json.page ?? 1}/${json.page_count ?? '?'} — licenses ${licenses}`);
  results.forEach((r, i) => {
    const lic = licenseOf(r);
    const flag = !lic.ok ? 'REFUSED' : lic.attributionRequired ? 'by     ' : 'free   ';
    console.log(`\n${String(i + 1).padStart(2)}. ${flag} ${shortLicense(r).padEnd(14)} ${r.width || '?'}×${r.height || '?'} ${(r.filetype || '').padEnd(5)} ${r.provider || ''}${r.source && r.source !== r.provider ? `/${r.source}` : ''}`);
    console.log(`    id: ${r.id}`);
    console.log(`    title: ${(r.title || '(untitled)').slice(0, 120)}  — creator: ${r.creator || 'unknown'}${r.creator_url ? ` <${r.creator_url}>` : ''}`);
    console.log(`    page: ${r.foreign_landing_url}`);
    console.log(`    file: ${r.url}`);
    if (r.attribution) console.log(`    attribution: ${String(r.attribution).replace(/\s+/g, ' ').trim()}`);
    if (r.mature || r.unstable__sensitivity?.length) console.log(`    flagged: ${r.mature ? 'mature ' : ''}${(r.unstable__sensitivity || []).join(',')}`);
  });
}

async function downloadOne(identifier, { token, outDir, intendedUse, explicitUse, allowBy, dryRun }) {
  const { json: r } = await api(`/images/${encodeURIComponent(identifier)}/`, {}, token);
  const lic = licenseOf(r);
  const label = `${r.title || identifier} (${r.provider || 'openverse'})`;
  if (!lic.ok) { console.error(`✗ ${label}: REFUSED — ${lic.reason}`); return 1; }
  if (lic.attributionRequired && !allowBy) {
    console.error(`✗ ${label}: ${lic.shortName} requires attribution; re-run with --allow-by to accept it (the credit line will be written to the ledger)`);
    return 1;
  }
  const clean = (u) => String(u || '').replace(/\?utm_[^#]*$/, '');
  const entry = {
    id: `openverse-${r.id}`,
    file: null,
    source: 'openverse',
    sourceName: `${r.provider || 'Openverse'} via Openverse`,
    sourceId: r.id,
    title: r.title || r.id,
    sourcePageUrl: r.foreign_landing_url || r.detail_url,
    sourceFileUrl: clean(r.url),
    downloadUrl: clean(r.url),
    author: r.creator || 'Unknown',
    authorUrl: r.creator_url || '',
    credit: `${r.provider || ''}${r.source && r.source !== r.provider ? ` (${r.source})` : ''}`.trim(),
    creditUrl: r.detail_url || `${API}/images/${r.id}/`,
    description: (r.tags || []).map((t) => t.name).filter(Boolean).slice(0, 12).join(', '),
    dateOriginal: '',
    license: { key: lic.key, shortName: lic.shortName, url: lic.url, attributionRequired: lic.attributionRequired, shareAlike: lic.shareAlike, sourceTag: `${r.license}${r.license_version ? ' ' + r.license_version : ''}` },
    licenseTag: r.license === 'pdm' ? 'Public Domain Mark' : '',
    originalWidth: r.width ?? null,
    originalHeight: r.height ?? null,
    originalSha1: null,
    originalMime: r.filetype ? `image/${r.filetype === 'jpg' ? 'jpeg' : r.filetype}` : null,
    requestedWidth: null,
    openverseAttribution: r.attribution ? String(r.attribution).replace(/\s+/g, ' ').trim() : '',
    intendedUse,
    retrievedAt: null,
    downloaded: false,
  };
  console.log(`• ${label}\n    ${lic.shortName} — ${entry.author} — ${r.width}×${r.height} ${r.filetype || ''}\n    ${entry.sourceFileUrl}`);
  if (dryRun) { console.log('    (dry run: not downloaded)'); return 0; }

  let got;
  entry.retrievedAt = new Date().toISOString();
  try {
    got = await downloadImage(entry.sourceFileUrl);
  } catch (e) {
    entry.error = e.message;
    console.error(`✗ ${label}: download failed — ${e.message}`);
  }
  const ext = got ? extForMime(got.mime) : (r.filetype || 'bin').toLowerCase().replace('jpeg', 'jpg');
  const target = join(outDir, `${entry.id}.${ext}`);
  entry.file = toPosix(relative(REPO_ROOT, target));
  if (got) {
    await mkdir(outDir, { recursive: true });
    await writeFile(target, got.buf);
    Object.assign(entry, { downloaded: true, mime: got.mime, width: got.width, height: got.height, bytes: got.bytes, sha256: got.sha256, changes: 'No changes made.' });
    entry.attribution = attributionString(entry);
    console.log(`    ✓ ${entry.file} — ${got.width}×${got.height} ${got.mime}, ${got.bytes} bytes, sha256 ${got.sha256.slice(0, 12)}…`);
  }
  const ledger = await loadLedger();
  upsertAsset(ledger, entry, { keep: explicitUse ? ['notes'] : ['intendedUse', 'notes'] });
  await saveLedger(ledger);
  await writeAttributions(ledger);
  console.log(`ledger: ${toPosix(relative(REPO_ROOT, LEDGER_PATH))} (${ledger.assets.length} entries) → ${toPosix(relative(REPO_ROOT, ATTRIBUTIONS_MD_PATH))}`);
  return got ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(`--${name}`); if (i >= 0) { args.splice(i, 1); return true; } return false; };
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  if (flag('help') || flag('h')) {
    console.log((await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const dryRun = flag('dry-run');
  const asJson = flag('json');
  const allowBy = flag('allow-by');
  const download = opt('download', '');
  const licenses = String(opt('license', 'cc0,pdm,by')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const pageSize = Number(opt('page-size', '20')) || 20;
  const page = Number(opt('page', '1')) || 1;
  const source = opt('source', '');
  const useText = opt('use', '');
  const outDir = resolve(REPO_ROOT, opt('out', DEFAULT_OUT));
  const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  const unknown = args.filter((a) => a.startsWith('--'));
  if (unknown.length) { console.error(`Unknown option(s): ${unknown.join(' ')}`); return 2; }
  const bad = licenses.filter((l) => !SEARCHABLE_LICENSES.includes(l));
  if (bad.length) { console.error(`Refusing to search license(s) outside the allowlist: ${bad.join(', ')} (allowed: ${SEARCHABLE_LICENSES.join(', ')})`); return 2; }
  if (!query && !download) { console.error('Usage: node scripts/fetch-openverse.mjs "<query>" [--license cc0,pdm,by] [--page-size 20] [--json]\n       node scripts/fetch-openverse.mjs --download <identifier> [--use "<text>"] [--allow-by] [--out <dir>] [--dry-run]'); return 2; }
  if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
    console.warn('HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not — Node fetch will bypass the proxy. Run: NODE_USE_ENV_PROXY=1 node scripts/fetch-openverse.mjs');
  }

  const token = await getToken();
  if (token) console.log('Openverse: using client-credentials token');

  if (download) {
    return downloadOne(download, { token, outDir, intendedUse: useText || 'TODO(Tyler & Sara): decide where this image is used', explicitUse: Boolean(useText), allowBy, dryRun });
  }

  let out;
  try {
    out = await api('/images/', { q: query, license: licenses.join(','), page_size: pageSize, page, source }, token);
  } catch (e) {
    console.error(`✗ search "${query}": ${e.message}`);
    return 1;
  }
  if (asJson) console.log(JSON.stringify(out.json, null, 2));
  else printResults(out.json, licenses.join(','));
  if (out.rate) console.log(`\nrate limit: ${out.rate}`);
  return 0;
}

process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'UNDICI-EHPA') console.warn(w.stack || w.message); });
main().then((code) => process.exit(code), (e) => { console.error(e.stack || e.message); process.exit(1); });
