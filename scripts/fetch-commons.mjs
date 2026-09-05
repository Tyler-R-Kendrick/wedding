#!/usr/bin/env node
// Fetch freely-licensed images from Wikimedia Commons into public/assets/commons/ and keep the
// license ledger (public/assets/attributions.json + public/assets/ATTRIBUTIONS.md) in sync.
//
//   export -n NODE_OPTIONS; NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs                    # default title list
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs "File:Some photo.jpg" "Other photo.png"     # your own titles
//   Options: --dry-run             resolve titles + check licenses only; write nothing
//            --out <dir>           download directory (default public/assets/commons)
//            --width <px>          widest rendition to fetch (default 2000; Commons rounds to a bucket, e.g. 1920)
//            --use "<text>"        intended use recorded for the titles given on the command line
//            --force               re-download even when the file on disk already matches the ledger
//            --category <title>    Commons category to list candidates from (default: the CAA building category)
//            --no-category         skip the candidate listing
//            --list-only           only list the category candidates (skip the title processing)
//            --check               CI gate, no network: every file in the download dir must have a complete,
//                                  allowed, hash-matching ledger entry and ATTRIBUTIONS.md must be in sync
//
// Network: outbound HTTPS in this sandbox goes through a proxy. Node's built-in fetch only honours
// HTTPS_PROXY when NODE_USE_ENV_PROXY=1 is set, so run every invocation as
// `NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs …`. Hosts contacted: commons.wikimedia.org
// (API) and upload.wikimedia.org / thumb.wikimedia.org (file bytes). Never venue or vendor sites.
//
// License discipline: only CC0, public domain, CC BY and CC BY-SA files are accepted (classifyLicense);
// anything else is refused before a byte is downloaded. Every file that lands gets a ledger entry with
// title, source page URL, file URL, creator, license short name + URL, attribution string, retrieval
// date, sha256, pixel size and intended use. Policy: docs/ops/asset-licensing.md.
//
// scripts/fetch-openverse.mjs imports the ledger/download helpers from this module; main() only runs
// when this file is the entry point.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = join(REPO_ROOT, 'public', 'assets', 'commons');
export const LEDGER_PATH = join(REPO_ROOT, 'public', 'assets', 'attributions.json');
export const ATTRIBUTIONS_MD_PATH = join(REPO_ROOT, 'public', 'assets', 'ATTRIBUTIONS.md');
export const POLICY_PATH = 'docs/ops/asset-licensing.md';
// Wikimedia asks for a descriptive User-Agent. Override with ASSETS_USER_AGENT if you want to add contact details.
export const USER_AGENT = process.env.ASSETS_USER_AGENT
  || 'wedding-assets-commons/0.1 (Tyler & Sara wedding site; personal, non-commercial; Node fetch)';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_CATEGORY = 'Category:Chicago Athletic Association Building';
// Thumbnail widths Wikimedia will render on demand (others answer HTTP 400). Verified 2026-09-05: 1920 ok, 2000/2560 refused.
const THUMB_BUCKETS = [3840, 1920, 1280, 1024, 960, 800, 640, 500, 400, 320];

// Default set: the four CAA building files whose licenses were checked by hand on 2026-09-05.
const DEFAULT_TITLES = [
  { title: 'Chicago Athletic Association Building.JPG',
    use: 'Explore CAA — facade portrait (Venetian Gothic front on Michigan Ave); placeholder until the couple\'s own venue photos arrive' },
  { title: 'Chicago Athletic Association Building 12 South Michigan Avenue.jpg',
    use: 'Explore CAA / The Wedding — venue exterior, portrait crop candidate; placeholder only' },
  { title: 'Chicago Athletic Association (15430675040).jpg',
    use: 'Explore CAA — wide landscape exterior for the venue card; placeholder only' },
  { title: 'Chicago Athletic Association building 1897.png',
    use: 'Our Story / Explore CAA — 1897 engraving for the building-history timeline (public domain; may be tinted or duotoned)' },
];

// ---------------------------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------------------------
export const ALLOWED_LICENSES = [
  { key: 'cc0',      name: 'CC0',       requires: 'nothing (public-domain dedication); credit given as a courtesy' },
  { key: 'pd',       name: 'Public domain', requires: 'nothing; credit the source as a courtesy' },
  { key: 'cc-by',    name: 'CC BY',     requires: 'attribution: title, creator, source link, license name + link, and a note of any changes' },
  { key: 'cc-by-sa', name: 'CC BY-SA',  requires: 'attribution as for CC BY, plus derivatives (crops, tints, composites) must carry the same license and version' },
];

/**
 * Decide whether a license is acceptable and normalise it.
 * Accepts Commons `LicenseShortName` strings ("CC BY-SA 3.0", "Public domain", "CC0") and Openverse codes
 * ("by", "by-sa", "cc0", "pdm") with an optional version. Anything NC, ND, GFDL-only, "fair use",
 * "copyrighted free use", or unrecognised is refused.
 */
export function classifyLicense({ shortName = '', code = '', version = '', url = '' } = {}) {
  const raw = String(shortName || code || '').replace(/\s+/g, ' ').trim();
  const s = raw.toLowerCase();
  const v = String(version || (s.match(/(?:^|\s)(\d\.\d|\d)(?=\s|$)/) || [])[1] || '').trim();
  const refuse = (reason) => ({ ok: false, reason, raw });
  if (!s) return refuse('no license tag on the source page');
  if (/\b(nc|nd|non-?commercial|no-?deriv)/.test(s)) return refuse(`non-commercial / no-derivatives license: ${raw}`);
  if (/^(cc0|cc-zero|cc 0)\b/.test(s)) {
    return { ok: true, key: 'cc0', shortName: `CC0 ${v || '1.0'}`, version: v || '1.0',
      url: url || 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false, shareAlike: false, raw };
  }
  if (/^(public domain|pd|pdm)\b/.test(s)) {
    return { ok: true, key: 'pd', shortName: 'Public domain', version: '',
      url: url || 'https://creativecommons.org/publicdomain/mark/1.0/', attributionRequired: false, shareAlike: false, raw };
  }
  let m = s.match(/^cc[ -]by[ -]sa(?:[ -](\d(?:\.\d)?))?$/) || (s === 'by-sa' ? [null, v] : null);
  if (m) {
    const ver = m[1] || v; if (!ver) return refuse(`CC BY-SA without a version: ${raw}`);
    return { ok: true, key: 'cc-by-sa', shortName: `CC BY-SA ${ver}`, version: ver,
      url: url || `https://creativecommons.org/licenses/by-sa/${ver}/`, attributionRequired: true, shareAlike: true, raw };
  }
  m = s.match(/^cc[ -]by(?:[ -](\d(?:\.\d)?))?$/) || (s === 'by' ? [null, v] : null);
  if (m) {
    const ver = m[1] || v; if (!ver) return refuse(`CC BY without a version: ${raw}`);
    return { ok: true, key: 'cc-by', shortName: `CC BY ${ver}`, version: ver,
      url: url || `https://creativecommons.org/licenses/by/${ver}/`, attributionRequired: true, shareAlike: false, raw };
  }
  return refuse(`license not in the allowlist (CC0 / public domain / CC BY / CC BY-SA): ${raw}`);
}

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function stripHtml(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstHref(html = '') {
  const m = String(html).match(/href="([^"]+)"/i);
  if (!m) return '';
  const h = m[1].replace(/&amp;/g, '&');
  if (/[?&]redlink=1\b/.test(h)) return '';
  return h.startsWith('//') ? `https:${h}` : h;
}

export function slugify(title) {
  return String(title)
    .replace(/^File:/i, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/tiff': 'tif' };
export const extForMime = (mime) => EXT_BY_MIME[mime] || 'bin';

/** Identify the image type from magic bytes and read its pixel size (JPEG/PNG/GIF/WebP; SVG via attributes). */
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ...jpegSize(buf) };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ...webpSize(buf) };
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    const w = head.match(/\bwidth="([\d.]+)/), h = head.match(/\bheight="([\d.]+)/), vb = head.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
    return { mime: 'image/svg+xml', width: Number(w?.[1] ?? vb?.[1]) || null, height: Number(h?.[1] ?? vb?.[2]) || null };
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buf.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) {
    return { mime: 'image/tiff', width: null, height: null };
  }
  return null;
}

function jpegSize(buf) {
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) { pos += 1; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buf.readUInt16BE(pos + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    pos += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(buf) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const b = buf.subarray(21, 25);
    return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  return { width: null, height: null };
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
export const toPosix = (p) => p.split('\\').join('/');

/** GET a URL that must be an image. Retries 429/5xx (honouring Retry-After), verifies Content-Type and magic bytes,
 * and returns bytes + hashes + pixel size. */
export async function downloadImage(url, { timeoutMs = 120_000, attempts = 4 } = {}) {
  const backoff = [10_000, 30_000, 60_000];
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429 || res.status >= 500) {
      res.body?.cancel().catch(() => {});
      if (i >= attempts - 1) throw new Error(`HTTP ${res.status} for ${url} (after ${attempts} attempts)`);
      const wait = (Number(res.headers.get('retry-after')) * 1000) || backoff[Math.min(i, backoff.length - 1)];
      console.warn(`    HTTP ${res.status} from ${new URL(url).host}, retrying in ${Math.round(wait / 1000)}s (${i + 1}/${attempts - 1})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error(`not an image (Content-Type ${contentType || 'missing'}) for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sniffed = sniffImage(buf);
    if (!sniffed) throw new Error(`bytes are not a recognised image format (Content-Type ${contentType}) for ${url}`);
    return { buf, contentType, mime: sniffed.mime, width: sniffed.width, height: sniffed.height, bytes: buf.length, sha256: sha256(buf), sha1: sha1(buf) };
  }
}

// ---------------------------------------------------------------------------------------------
// Ledger (public/assets/attributions.json) and ATTRIBUTIONS.md
// ---------------------------------------------------------------------------------------------
export function emptyLedger() {
  return {
    version: 1,
    policy: POLICY_PATH,
    generatedBy: ['scripts/fetch-commons.mjs', 'scripts/fetch-openverse.mjs'],
    generatedAt: null,
    allowedLicenses: ALLOWED_LICENSES,
    assets: [],
  };
}

export async function loadLedger(path = LEDGER_PATH) {
  try {
    const ledger = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(ledger.assets)) throw new Error(`${path}: "assets" must be an array`);
    return ledger;
  } catch (e) {
    if (e.code === 'ENOENT') return emptyLedger();
    throw e;
  }
}

/** Insert or replace by `id`. Human-edited fields listed in `keep` survive re-runs. */
export function upsertAsset(ledger, entry, { keep = ['intendedUse', 'notes'] } = {}) {
  const i = ledger.assets.findIndex((a) => a.id === entry.id);
  if (i >= 0) {
    const prev = ledger.assets[i];
    const merged = { ...entry };
    for (const k of keep) if (prev[k] != null && prev[k] !== '') merged[k] = prev[k];
    ledger.assets[i] = merged;
  } else {
    ledger.assets.push(entry);
  }
  ledger.assets.sort((a, b) => a.id.localeCompare(b.id));
  return ledger;
}

export async function saveLedger(ledger, path = LEDGER_PATH) {
  ledger.version = 1;
  ledger.policy = POLICY_PATH;
  ledger.generatedBy = ['scripts/fetch-commons.mjs', 'scripts/fetch-openverse.mjs'];
  ledger.generatedAt = new Date().toISOString();
  ledger.allowedLicenses = ALLOWED_LICENSES;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ledger, null, 2) + '\n');
}

/** Human-readable credit line in the shape each license asks for (TASL for CC BY / BY-SA). */
export function attributionString(e) {
  const title = `"${e.title}"`;
  const by = e.author ? ` by ${e.author}` : '';
  const via = `${e.sourceName} (${e.sourcePageUrl})`;
  if (!e.license.attributionRequired) {
    return `${title}${by}, ${e.license.shortName}${e.license.key === 'pd' && e.licenseTag ? ` (${e.licenseTag})` : ''}, via ${via}.${e.changes ? ` ${e.changes}` : ''}`;
  }
  const sa = e.license.shareAlike ? ' Derivatives must be shared under the same license.' : '';
  return `${title}${by}, licensed under ${e.license.shortName} (${e.license.url}), via ${via}.${e.changes ? ` ${e.changes}` : ''}${sa}`;
}

const mdCell = (s = '') => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const px = (e) => (e.width && e.height ? `${e.width}×${e.height}` : (e.downloaded ? '?' : '—'));

export function renderAttributions(ledger) {
  const assets = [...ledger.assets].sort((a, b) => a.id.localeCompare(b.id));
  const groups = {
    'cc-by-sa': { heading: 'Attribution + ShareAlike (CC BY-SA)', note: 'Credit as below wherever the image appears. Any derivative — crop, tint, duotone, composite, animation frame — must be published under the **same CC BY-SA license and version**, with the license linked.' },
    'cc-by':    { heading: 'Attribution (CC BY)', note: 'Credit as below wherever the image appears (caption, credits page, or a `<figcaption>`). Indicate changes.' },
    'cc0':      { heading: 'CC0 (no attribution required)', note: 'Credit is optional; we give it anyway.' },
    'pd':       { heading: 'Public domain (no attribution required)', note: 'Credit is optional; we give it anyway and keep the provenance link.' },
  };
  const lines = [];
  lines.push('# Third-party image attributions');
  lines.push('');
  lines.push(`Generated from \`public/assets/attributions.json\` by \`scripts/fetch-commons.mjs\` / \`scripts/fetch-openverse.mjs\` — do not edit by hand; re-run the script. Policy: \`${POLICY_PATH}\`. Last generated ${ledger.generatedAt ?? '(unsaved)'}.`);
  lines.push('');
  lines.push('Every file under `public/assets/commons/` must appear here. Entries marked *not downloaded* have metadata but no bytes on disk yet (download failed or was skipped); re-run the script to fetch them.');
  lines.push('');
  lines.push('## Ledger');
  lines.push('');
  lines.push('| File | Title | Creator | License | Source | Pixels | Retrieved | Intended use |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const e of assets) {
    const file = e.downloaded ? `\`${mdCell(e.file.replace(/^public\/assets\//, ''))}\`` : `\`${mdCell(e.file.replace(/^public\/assets\//, ''))}\` *(not downloaded)*`;
    const creator = e.authorUrl ? `[${mdCell(e.author)}](${e.authorUrl})` : mdCell(e.author || '—');
    lines.push(`| ${file} | ${mdCell(e.title)} | ${creator} | [${mdCell(e.license.shortName)}](${e.license.url}) | [${mdCell(e.sourceName)}](${e.sourcePageUrl}) | ${px(e)} | ${(e.retrievedAt || '').slice(0, 10)} | ${mdCell(e.intendedUse || '')} |`);
  }
  lines.push('');
  lines.push('## Attribution lines');
  lines.push('');
  lines.push('Use the `attribution` field from `attributions.json` (identical to the lines below) wherever an image is shown; the site credits page should list all of them.');
  for (const key of Object.keys(groups)) {
    const items = assets.filter((e) => e.license.key === key);
    if (!items.length) continue;
    lines.push('');
    lines.push(`### ${groups[key].heading}`);
    lines.push('');
    lines.push(groups[key].note);
    lines.push('');
    for (const e of items) lines.push(`- \`${e.file.replace(/^public\/assets\//, '')}\` — ${e.attribution || attributionString(e)}${e.downloaded ? '' : ' *(not downloaded yet)*'}`);
  }
  lines.push('');
  lines.push('## Provenance detail');
  lines.push('');
  for (const e of assets) {
    lines.push(`### \`${e.file.replace(/^public\/assets\//, '')}\``);
    lines.push('');
    lines.push(`- Source page: <${e.sourcePageUrl}>`);
    lines.push(`- Original file: <${e.sourceFileUrl}>${e.originalWidth ? ` (${e.originalWidth}×${e.originalHeight}${e.originalSha1 ? `, sha1 ${e.originalSha1}` : ''})` : ''}`);
    if (e.downloadUrl && e.downloadUrl !== e.sourceFileUrl) lines.push(`- Downloaded rendition: <${e.downloadUrl}>`);
    if (e.credit) lines.push(`- Credit / origin: ${e.credit === e.creditUrl ? `<${e.creditUrl}>` : `${mdCell(e.credit)}${e.creditUrl ? ` (<${e.creditUrl}>)` : ''}`}`);
    if (e.dateOriginal) lines.push(`- Date of work: ${mdCell(e.dateOriginal)}`);
    if (e.description) lines.push(`- Description: ${mdCell(e.description)}`);
    lines.push(`- License: ${e.license.shortName} — <${e.license.url}>${e.licenseTag ? ` (source tag: ${e.licenseTag})` : ''}`);
    lines.push(`- Retrieved: ${e.retrievedAt || '—'}${e.downloaded ? `; sha256 \`${e.sha256}\`; ${e.bytes} bytes; ${px(e)} ${e.mime}` : '; **not downloaded**' + (e.error ? ` — ${mdCell(e.error)}` : '')}`);
    lines.push(`- Intended use: ${mdCell(e.intendedUse || 'TODO(Tyler & Sara)')}`);
    if (e.notes) lines.push(`- Notes: ${mdCell(e.notes)}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function writeAttributions(ledger, path = ATTRIBUTIONS_MD_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderAttributions(ledger) + '\n');
}

// ---------------------------------------------------------------------------------------------
// Commons API
// ---------------------------------------------------------------------------------------------
let lastApiCall = 0;
export async function commonsApi(params, { attempts = 4 } = {}) {
  const url = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', maxlag: '5', ...params })) url.searchParams.set(k, v);
  const backoff = [5_000, 15_000, 30_000, 60_000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const wait = Math.max(0, lastApiCall + 1_000 - Date.now()); // be polite: >=1 s between calls
    if (wait) await sleep(wait);
    lastApiCall = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
      const text = await res.text();
      const ct = res.headers.get('content-type') || '';
      if (res.status === 429 || /too many requests/i.test(text) || !ct.includes('json')) {
        throw new Error(`Commons API throttled or non-JSON (HTTP ${res.status}): ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
      }
      const json = JSON.parse(text);
      if (json.error) {
        if (json.error.code === 'maxlag') throw new Error(`Commons API maxlag: ${json.error.info}`);
        throw Object.assign(new Error(`Commons API error ${json.error.code}: ${json.error.info}`), { fatal: true });
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (e.fatal || i === attempts - 1) break;
      console.warn(`  retry ${i + 1}/${attempts - 1} in ${backoff[i] / 1000}s — ${e.message}`);
      await sleep(backoff[i]);
    }
  }
  throw lastErr;
}

const normTitle = (t) => { const s = String(t).trim().replace(/_/g, ' '); return /^File:/i.test(s) ? `File:${s.slice(5)}` : `File:${s}`; };

/** imageinfo for up to 50 titles per request. Returns pages in API order (normalised titles). */
export async function queryImageInfo(titles, { width = 2000, filter } = {}) {
  const pages = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).map(normTitle);
    const params = { action: 'query', titles: batch.join('|'), prop: 'imageinfo', iiprop: 'url|size|sha1|mime|extmetadata', iiurlwidth: String(width), iiextmetadatalanguage: 'en' };
    if (filter) params.iiextmetadatafilter = filter;
    const json = await commonsApi(params);
    pages.push(...(json.query?.pages ?? []));
  }
  return pages;
}

export async function listCategoryFiles(category) {
  const titles = [];
  let cmcontinue;
  do {
    const params = { action: 'query', list: 'categorymembers', cmtitle: category, cmtype: 'file', cmlimit: '100' };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const json = await commonsApi(params);
    titles.push(...(json.query?.categorymembers ?? []).map((m) => m.title));
    cmcontinue = json.continue?.cmcontinue;
  } while (cmcontinue);
  return titles;
}

/** Map one Commons page (formatversion=2) to a ledger entry, without downloading. */
export function commonsEntry(page, { intendedUse, targetWidth }) {
  const ii = page.imageinfo?.[0];
  const m = ii?.extmetadata ?? {};
  const val = (k) => m[k]?.value ?? '';
  const license = classifyLicense({ shortName: val('LicenseShortName') || val('License'), url: stripHtml(val('LicenseUrl')) });
  const categories = String(val('Categories')).split('|').map((s) => s.trim());
  const licenseTag = license.ok && license.key === 'pd' ? (categories.find((c) => /^PD[ -]/i.test(c)) || '') : '';
  const clean = (u) => String(u || '').replace(/\?utm_[^#]*$/, '');
  const artistHtml = val('Artist');
  const creditHtml = val('Credit');
  return {
    id: slugify(page.title),
    file: null, // set once downloaded
    source: 'wikimedia-commons',
    sourceName: 'Wikimedia Commons',
    sourceId: page.pageid ?? null,
    title: page.title.replace(/^File:/, ''),
    sourcePageUrl: ii?.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    sourceFileUrl: clean(ii?.url),
    downloadUrl: null,
    author: stripHtml(artistHtml) || stripHtml(creditHtml) || 'Unknown',
    authorUrl: firstHref(artistHtml),
    credit: stripHtml(creditHtml),
    creditUrl: firstHref(creditHtml),
    description: stripHtml(val('ImageDescription')).slice(0, 500),
    dateOriginal: stripHtml(val('DateTimeOriginal')),
    license: license.ok ? { key: license.key, shortName: license.shortName, url: license.url, attributionRequired: license.attributionRequired, shareAlike: license.shareAlike, sourceTag: license.raw, usageTerms: stripHtml(val('UsageTerms')) } : null,
    licenseTag,
    licenseCheck: license,
    originalWidth: ii?.width ?? null,
    originalHeight: ii?.height ?? null,
    originalSha1: ii?.sha1 ?? null,
    originalMime: ii?.mime ?? null,
    requestedWidth: targetWidth,
    intendedUse,
    retrievedAt: null,
    downloaded: false,
    _imageinfo: ii,
  };
}

/** Rendition URLs to try, widest-first but never wider than targetWidth unless nothing else exists. */
export function renditionCandidates(ii, targetWidth) {
  const clean = (u) => String(u || '').replace(/\?utm_[^#]*$/, '');
  const original = clean(ii.url);
  if (!ii.width || ii.width <= targetWidth) return [{ url: original, width: ii.width, kind: 'original' }];
  const out = [];
  const thumb = clean(ii.thumburl);
  const m = thumb.match(/\/(\d+)px-/);
  if (m) {
    const apiW = Number(m[1]);
    if (apiW <= targetWidth) out.push({ url: thumb, width: apiW, kind: 'thumb' });
    const widths = [...new Set([targetWidth, ...THUMB_BUCKETS])].filter((w) => w <= targetWidth && w < ii.width && w !== apiW).sort((a, b) => b - a);
    for (const w of widths) out.push({ url: thumb.replace(/\/\d+px-/, `/${w}px-`), width: w, kind: 'thumb' });
    if (apiW > targetWidth) out.push({ url: thumb, width: apiW, kind: 'thumb-oversize' });
  }
  out.push({ url: original, width: ii.width, kind: 'original-oversize' });
  return out;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
/** CI gate: every file in the download directory must have a complete, allowed, hash-matching ledger entry. */
export async function checkLedger(outDir = DEFAULT_OUT, { ledgerPath = LEDGER_PATH, mdPath = ATTRIBUTIONS_MD_PATH } = {}) {
  const ledger = await loadLedger(ledgerPath);
  const files = (await readdir(outDir).catch((e) => { if (e.code === 'ENOENT') return []; throw e; })).filter((f) => !f.startsWith('.'));
  const byFile = new Map(ledger.assets.map((a) => [a.file, a]));
  const problems = [];
  const REQUIRED = ['title', 'sourcePageUrl', 'sourceFileUrl', 'author', 'retrievedAt', 'sha256', 'width', 'height', 'intendedUse', 'attribution'];
  for (const f of files) {
    const rel = toPosix(relative(REPO_ROOT, join(outDir, f)));
    const e = byFile.get(rel);
    if (!e) { problems.push(`${rel}: no ledger entry (delete the file, or fetch it through scripts/fetch-commons.mjs / fetch-openverse.mjs)`); continue; }
    if (!e.downloaded) problems.push(`${rel}: ledger says downloaded=false but the file exists`);
    const buf = await readFile(join(outDir, f));
    if (e.sha256 && sha256(buf) !== e.sha256) problems.push(`${rel}: sha256 mismatch — file changed since retrieval (re-fetch, or record the edit as a derivative)`);
    const lic = classifyLicense({ shortName: e.license?.shortName || '' });
    if (!lic.ok) problems.push(`${rel}: license not allowed — ${lic.reason}`);
    else if (!e.license?.url) problems.push(`${rel}: license URL missing`);
    for (const k of REQUIRED) if (e[k] == null || e[k] === '') problems.push(`${rel}: missing "${k}"`);
    if (e.license?.attributionRequired && !e.attribution) problems.push(`${rel}: attribution required by ${e.license.shortName} but missing`);
  }
  for (const e of ledger.assets) {
    if (e.downloaded && e.file && dirname(resolve(REPO_ROOT, e.file)) === outDir && !files.includes(basename(e.file))) problems.push(`${e.file}: in ledger as downloaded but not on disk`);
  }
  const mdRel = toPosix(relative(REPO_ROOT, mdPath));
  try {
    const md = await readFile(mdPath, 'utf8');
    if (md !== renderAttributions(ledger) + '\n') problems.push(`${mdRel}: out of date — regenerate by re-running the fetch script`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (ledger.assets.length) problems.push(`${mdRel}: missing`);
  }
  const rel = toPosix(relative(REPO_ROOT, outDir));
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`${problems.length} problem(s): ${rel}/ vs ${toPosix(relative(REPO_ROOT, ledgerPath))}`);
    return 1;
  }
  console.log(`✓ ${files.length} file(s) in ${rel}/ all have complete, allowed, hash-matching ledger entries; ${mdRel} is in sync`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(`--${name}`); if (i >= 0) { args.splice(i, 1); return true; } return false; };
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  if (flag('help') || flag('h')) { console.log(await readFile(fileURLToPath(import.meta.url), 'utf8').then((s) => s.split('\n').slice(1, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))); return 0; }
  const dryRun = flag('dry-run');
  const force = flag('force');
  const noCategory = flag('no-category');
  const listOnly = flag('list-only');
  const check = flag('check');
  const outDir = resolve(REPO_ROOT, opt('out', DEFAULT_OUT));
  const width = Number(opt('width', '2000')) || 2000;
  const useText = opt('use', '');
  const category = noCategory ? null : opt('category', DEFAULT_CATEGORY);
  const positional = args.filter((a) => !a.startsWith('--'));
  const unknown = args.filter((a) => a.startsWith('--'));
  if (unknown.length) { console.error(`Unknown option(s): ${unknown.join(' ')}`); return 2; }
  if (check) return checkLedger(outDir);

  if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1') {
    console.warn('HTTPS_PROXY is set but NODE_USE_ENV_PROXY is not — Node fetch will bypass the proxy. Run: NODE_USE_ENV_PROXY=1 node scripts/fetch-commons.mjs');
  }

  const wanted = positional.length
    ? positional.map((t) => ({ title: t, use: useText || 'TODO(Tyler & Sara): decide where this image is used', explicitUse: Boolean(useText) }))
    : DEFAULT_TITLES.map((d) => ({ ...d, explicitUse: false }));
  const outRel = toPosix(relative(REPO_ROOT, outDir));
  if (!listOnly) console.log(`fetch-commons: ${wanted.length} title(s) → ${outRel}/ ${dryRun ? '(dry run: nothing will be written)' : ''}`);

  let pages;
  try {
    pages = listOnly ? [] : await queryImageInfo(wanted.map((w) => w.title), { width });
  } catch (e) {
    console.error(`commons.wikimedia.org unreachable or refused: ${e.message}`);
    return 1;
  }

  const ledger = await loadLedger();
  const results = [];
  let failures = 0;
  for (const page of pages) {
    const want = wanted.find((w) => normTitle(w.title).toLowerCase() === page.title.toLowerCase())
      ?? wanted.find((w) => slugify(w.title) === slugify(page.title)) ?? { use: useText, explicitUse: false };
    const label = page.title.replace(/^File:/, '');
    if (page.missing || page.invalid || !page.imageinfo?.length) {
      console.error(`✗ ${label}: not found on Commons`);
      failures++; results.push({ title: label, status: 'missing' });
      continue;
    }
    const entry = commonsEntry(page, { intendedUse: want.use, targetWidth: width });
    if (!entry.licenseCheck.ok) {
      console.error(`✗ ${label}: REFUSED — ${entry.licenseCheck.reason}`);
      failures++; results.push({ title: label, status: 'refused', license: entry.licenseCheck.raw });
      continue;
    }
    const ii = entry._imageinfo;
    const ext = extForMime(ii.mime) === 'bin' ? (label.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase().replace('jpeg', 'jpg') : extForMime(ii.mime);
    const target = join(outDir, `${entry.id}.${ext}`);
    entry.file = toPosix(relative(REPO_ROOT, target));
    const candidates = renditionCandidates(ii, width);
    console.log(`• ${label}\n    ${entry.license.shortName} — ${entry.author} — original ${ii.width}×${ii.height} ${ii.mime}\n    → ${entry.file} (trying ${candidates.slice(0, 4).map((c) => c.width + 'px').join(', ')}${candidates.length > 4 ? ', …' : ''})`);
    if (dryRun) { results.push({ title: label, status: 'ok (dry run)', license: entry.license.shortName, file: entry.file }); continue; }

    // Skip if the on-disk file matches the ledger.
    const prev = ledger.assets.find((a) => a.id === entry.id);
    if (!force && prev?.downloaded && prev.sha256) {
      try {
        const existing = await readFile(target);
        if (sha256(existing) === prev.sha256) {
          console.log(`    = unchanged on disk (sha256 ${prev.sha256.slice(0, 12)}…), skipping download (--force to refetch)`);
          delete entry._imageinfo; delete entry.licenseCheck;
          // metadata refreshes from Commons on every run; the download facts stay as recorded
          const keepEntry = { ...entry, downloaded: true, downloadUrl: prev.downloadUrl, mime: prev.mime, width: prev.width, height: prev.height, bytes: prev.bytes, sha256: prev.sha256, retrievedAt: prev.retrievedAt, changes: prev.changes };
          keepEntry.attribution = attributionString(keepEntry);
          upsertAsset(ledger, keepEntry, { keep: want.explicitUse ? ['notes'] : ['intendedUse', 'notes'] });
          results.push({ title: label, status: 'unchanged', license: entry.license.shortName, file: entry.file, px: px(prev) });
          continue;
        }
      } catch { /* not on disk → download */ }
    }

    let got = null, lastErr = null;
    for (const c of candidates) {
      try {
        const img = await downloadImage(c.url);
        if (c.kind === 'original' && ii.sha1 && img.sha1 !== ii.sha1) throw new Error(`sha1 mismatch vs Commons (${img.sha1} ≠ ${ii.sha1})`);
        got = { ...img, url: c.url, kind: c.kind };
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`    ${c.width}px: ${e.message}`);
      }
    }
    entry.retrievedAt = new Date().toISOString();
    delete entry._imageinfo; delete entry.licenseCheck;
    if (!got) {
      entry.downloaded = false;
      entry.error = lastErr?.message || 'download failed';
      entry.attribution = attributionString(entry);
      console.error(`✗ ${label}: download failed — ${entry.error}`);
      failures++;
      upsertAsset(ledger, entry, { keep: want.explicitUse ? ['notes'] : ['intendedUse', 'notes'] });
      results.push({ title: label, status: 'not downloaded', license: entry.license.shortName, file: entry.file });
      continue;
    }
    await mkdir(outDir, { recursive: true });
    await writeFile(target, got.buf);
    Object.assign(entry, {
      downloaded: true, downloadUrl: got.url, mime: got.mime, width: got.width, height: got.height, bytes: got.bytes, sha256: got.sha256,
      changes: got.kind === 'original' ? 'No changes made.' : `Resized by Wikimedia to ${got.width}×${got.height} from the ${ii.width}×${ii.height} original; no other changes.`,
    });
    entry.attribution = attributionString(entry);
    upsertAsset(ledger, entry, { keep: want.explicitUse ? ['notes'] : ['intendedUse', 'notes'] });
    console.log(`    ✓ ${got.width}×${got.height} ${got.mime}, ${got.bytes} bytes, sha256 ${got.sha256.slice(0, 12)}…`);
    results.push({ title: label, status: 'downloaded', license: entry.license.shortName, file: entry.file, px: `${got.width}×${got.height}` });
  }

  if (!dryRun && !listOnly) {
    await saveLedger(ledger);
    await writeAttributions(ledger);
    console.log(`ledger: ${toPosix(relative(REPO_ROOT, LEDGER_PATH))} (${ledger.assets.length} entries) → ${toPosix(relative(REPO_ROOT, ATTRIBUTIONS_MD_PATH))}`);
  }

  if (!listOnly) console.log('\nsummary');
  for (const r of results) console.log(`  ${r.status.padEnd(15)} ${(r.license || '').padEnd(14)} ${(r.px || '').padEnd(10)} ${r.title}`);

  if (category) {
    console.log(`\ncandidates in ${category} (listing only — nothing is downloaded from here)`);
    try {
      const titles = await listCategoryFiles(category);
      const info = await queryImageInfo(titles, { width, filter: 'LicenseShortName|LicenseUrl|Artist|DateTimeOriginal' });
      const defaults = new Set(DEFAULT_TITLES.map((d) => normTitle(d.title).toLowerCase()));
      let allowed = 0;
      for (const p of info.sort((a, b) => a.title.localeCompare(b.title))) {
        const ii = p.imageinfo?.[0]; const m = ii?.extmetadata ?? {};
        const lic = classifyLicense({ shortName: m.LicenseShortName?.value || '', url: stripHtml(m.LicenseUrl?.value || '') });
        const tag = defaults.has(p.title.toLowerCase()) ? 'default ' : (lic.ok ? 'allowed ' : 'REFUSED ');
        if (lic.ok && !defaults.has(p.title.toLowerCase())) allowed++;
        console.log(`  ${tag} ${(lic.ok ? lic.shortName : lic.raw || '(no tag)').padEnd(16)} ${ii ? `${ii.width}×${ii.height}`.padEnd(11) : '?'.padEnd(11)} ${(ii?.mime || '').padEnd(11)} ${p.title.replace(/^File:/, '')}${lic.ok ? '' : ` — ${lic.reason}`}`);
      }
      console.log(`  ${info.length} files; ${allowed} additional freely-licensed candidate(s) beyond the default set`);
    } catch (e) {
      console.warn(`  category listing failed: ${e.message}`);
    }
  }
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.removeAllListeners('warning');
  process.on('warning', (w) => { if (w.code !== 'UNDICI-EHPA') console.warn(w.stack || w.message); });
  main().then((code) => process.exit(code), (e) => { console.error(e.stack || e.message); process.exit(1); });
}
