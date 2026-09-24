/**
 * Captures the real site into the design pipeline's baseline (stages/02-wireframe/baseline/), so
 * every stage redraws the pages production actually renders: the same markup, the same stylesheets,
 * the same layout at every width. Stage 2 greys it out, stage 3 turns its content into bones, stage 4
 * swaps its copy for stand-ins in each design.
 *
 *   npm run stages:capture                          # every page, every design
 *   npm run stages:capture -- --only home,rsvp      # some pages
 *   npm run stages:capture -- --all-from-app        # everything from the app below (offline)
 *
 * Where each page comes from:
 *   public, gate   production itself (--production, default https://kendrick.wedding): what anyone
 *                  with the link is served today.
 *   guest, admin   production cannot show these without a real account, so they come from the same
 *                  code run as the app's test server (--app, default http://localhost:3331), signed in
 *                  as the seeded fixture household or admin. Start it as docs/ops/demos.md does
 *                  ("the test server": NODE_ENV=test, SEED_TEST_FIXTURES=1, TEST_AUTH_SECRET).
 * Each design is captured with `?theme=<id>` in a browser context of its own. A patterned page
 * (`/our-adventures/[slug]`) is captured at the first real instance its parent page links to.
 *
 * Every request goes through a retrying fetch: a stylesheet that fails to load would be captured as
 * an unstyled page. A page is read only once every stylesheet it links has loaded.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { PAGES, isPatterned, matches, pageForUrl, type SitemapPage } from '@wedding/sitemap';
import { fixtureId } from '../../src/db/seed/ids';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'stages/02-wireframe/baseline');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
const PRODUCTION = opt('production', 'https://kendrick.wedding').replace(/\/$/, '');
const APP = opt('app', 'http://localhost:3331').replace(/\/$/, '');
const ALL_FROM_APP = args.includes('--all-from-app');
const ONLY = opt('only', '').split(',').filter(Boolean);
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET ?? 'ci-only-test-auth-secret-not-real';
/** The designs a guest can be shown (src/themes/registry.ts). The first is production's default. */
export const DESIGNS = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;
const WIDTH = 1280;

const PRINCIPALS = {
  guest: { kind: 'guest', guestId: fixtureId('GSTA1'), householdId: fixtureId('HHA'), actsFor: [fixtureId('GSTA1'), fixtureId('GSTA2'), fixtureId('GSTA3')] },
  admin: { kind: 'admin', adminId: fixtureId('ADMIN1') },
} as const;

interface Source {
  name: 'production' | 'app';
  origin: string;
  principal: keyof typeof PRINCIPALS | null;
}
function sourceFor(p: SitemapPage): Source {
  if (p.audience === 'guest' || p.audience === 'admin') return { name: 'app', origin: APP, principal: p.audience };
  return ALL_FROM_APP ? { name: 'app', origin: APP, principal: null } : { name: 'production', origin: PRODUCTION, principal: null };
}

interface Captured {
  title: string;
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
  body: string;
  styles: ({ href: string } | { text: string })[];
  assets: string[];
  rawLinks: string[];
}

// The file is one arrow function; it is called in the page with the sitemap as its argument.
const DOM = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture-dom.js'), 'utf8').trim().replace(/;$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await sleep(400 * 2 ** i);
    }
  }
  throw new Error(`${what}: ${last instanceof Error ? last.message : String(last)}`);
}

const contexts = new Map<string, BrowserContext>();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function contextFor(source: Source, design: string): Promise<BrowserContext> {
  const key = `${source.name}|${source.principal}|${design}`;
  const known = contexts.get(key);
  if (known) return known;
  const headers: Record<string, string> = source.principal ? { 'x-test-auth': TEST_AUTH_SECRET, 'x-test-principal': JSON.stringify(PRINCIPALS[source.principal]) } : {};
  // The sandbox and CI reach production through proxies that re-sign TLS; the capture reads public pages.
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, extraHTTPHeaders: headers, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  await ctx.route('**/*', async (route) => {
    try {
      const response = await withRetry(route.request().url(), () => route.fetch({ maxRedirects: 0, timeout: 45_000 }), 5);
      await route.fulfill({ response });
    } catch {
      await route.abort('failed').catch(() => {});
    }
  });
  contexts.set(key, ctx);
  return ctx;
}

async function stylesLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')].every((l) => l.media === 'print' || (l.sheet !== null && (() => {
    try {
      return l.sheet!.cssRules.length >= 0;
    } catch {
      return false;
    }
  })())));
}

async function capturePage(source: Source, design: string, url: string): Promise<{ status: number; data: Captured; finalUrl: string }> {
  const ctx = await contextFor(source, design);
  const page = await ctx.newPage();
  try {
    const target = `${source.origin}${url}${design === DESIGNS[0] ? '' : `${url.includes('?') ? '&' : '?'}theme=${design}`}`;
    for (let attempt = 1; ; attempt++) {
      const res = await page.goto(target, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      await sleep(600);
      if ((await stylesLoaded(page)) || attempt === 3) {
        // Scroll the whole page once, as a reader would: sections reveal as they come into view and
        // lazy images load, and a capture taken from the top would keep them hidden for good.
        await page.evaluate(`(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 450) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 700));
        })()`);
        const pages = PAGES.map((p) => ({ path: p.path, url: p.example ?? p.path }));
        const data = (await page.evaluate(`(${DOM})(${JSON.stringify({ pages })})`)) as Captured;
        return { status: res?.status() ?? 0, data, finalUrl: page.url() };
      }
    }
  } finally {
    await page.close();
  }
}

/** Fetches a stylesheet through the same retrying route, and roots every url() it holds. */
const sheets = new Map<string, { text: string; assets: string[] }>();
async function stylesheet(source: Source, design: string, href: string, assets: Set<string>): Promise<string> {
  let sheet = sheets.get(href);
  if (!sheet) {
    const ctx = await contextFor(source, design);
    const raw = await withRetry(href, async () => {
      const r = await ctx.request.get(href, { timeout: 45_000 });
      if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
      return r.text();
    });
    const found = new Set<string>();
    sheet = { text: rootUrls(raw, href, found), assets: [...found] };
    sheets.set(href, sheet);
  }
  for (const a of sheet.assets) assets.add(a);
  return sheet.text;
}

function rootUrls(css: string, base: string, assets: Set<string>): string {
  const origin = new URL(base).origin;
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q, raw: string) => {
    if (raw.startsWith('data:') || raw.startsWith('#')) return all;
    const u = new URL(raw, base);
    if (u.origin !== origin) return `url("${u.href}")`;
    assets.add(u.pathname);
    return `url("${u.pathname}")`;
  });
}

// --- Run. ------------------------------------------------------------------------------------------
const selected = PAGES.filter((p) => ONLY.length === 0 || ONLY.includes(p.id));
// Plain pages first: a patterned page is captured at an instance one of them links to.
const ordered = [...selected.filter((p) => !isPatterned(p.path)), ...selected.filter((p) => isPatterned(p.path))];
const seenLinks = new Map<string, string[]>();
const indexPath = path.join(OUT, 'index.json');
const index: { pages: Record<string, unknown> } = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { pages: {} };
mkdirSync(path.join(OUT, 'css'), { recursive: true });
const failures: string[] = [];

/** Where each page was captured, so a page nested under a patterned one starts from its instance. */
const resolved = new Map<string, string>();

/**
 * A real instance of a patterned page (`/our-adventures/[slug]`): the first link to one that the
 * source has served, looking on its parent page if nothing seen so far points at one.
 */
async function instanceFor(p: SitemapPage, source: Source): Promise<string | null> {
  // The link must be this page, not a more specific sibling: `/admin/content/t/new` fits the
  // row pattern `/admin/content/[table]/[row]` too, but it is the new-row page.
  const find = () => (seenLinks.get(source.name) ?? []).find((l) => matches(p.path, l) && l !== p.example && pageForUrl(l)?.id === p.id) ?? null;
  if (find()) return find();
  const parent = p.parent ? PAGES.find((x) => x.id === p.parent) : undefined;
  const parentUrl = parent && (resolved.get(parent.id) ?? (isPatterned(parent.path) ? null : (parent.example ?? parent.path)));
  if (!parentUrl) return null;
  const { data } = await capturePage({ ...source, principal: source.principal ?? (parent!.audience === 'guest' || parent!.audience === 'admin' ? parent!.audience : null) }, DESIGNS[0], parentUrl);
  seenLinks.set(source.name, [...(seenLinks.get(source.name) ?? []), ...data.rawLinks]);
  return find();
}

for (const p of ordered) {
  let source = sourceFor(p);
  let url = p.example ?? p.path;
  if (isPatterned(p.path)) {
    let instance = await instanceFor(p, source).catch(() => null);
    // Production has none (no photo collection published yet, say): the same code, with fixture
    // data, has one. The index says which source each page came from.
    if (!instance && source.name === 'production') {
      const app: Source = { name: 'app', origin: APP, principal: null };
      instance = await instanceFor(p, app).catch(() => null);
      if (instance) source = app;
    }
    if (instance) url = instance;
  }
  const pageDir = path.join(OUT, 'pages', p.id);
  // The old capture goes only once the new one has succeeded in production's design.
  let cleared = false;
  const designs: Record<string, { status: number; file: string; same?: string }> = {};
  const bodies = new Map<string, string>();
  let meta: { title: string; url: string; finalUrl: string } | null = null;
  for (const design of DESIGNS) {
    try {
      const { status, data, finalUrl } = await capturePage(source, design, url);
      // An error page is not a baseline of anything: say so, and keep what was there before.
      if (status >= 400) throw new Error(`${source.origin}${url} answered ${status}`);
      if (design === DESIGNS[0]) {
        seenLinks.set(source.name, [...(seenLinks.get(source.name) ?? []), ...data.rawLinks]);
        resolved.set(p.id, url);
      }
      // A design the source does not serve (or a page no design changes) is not stored twice.
      const served = data.htmlAttrs['data-theme'] ?? design;
      if (design !== DESIGNS[0] && served !== design) continue;
      const same = [...bodies.entries()].find(([, b]) => b === data.body)?.[0];
      if (same) {
        designs[design] = { status, file: designs[same]!.file, same };
        continue;
      }
      const assets = new Set(data.assets);
      const css: string[] = [];
      for (const s of data.styles) {
        const text = 'href' in s ? await stylesheet(source, design, s.href, assets) : rootUrls(s.text, finalUrl, assets);
        const id = sha(text);
        const file = path.join(OUT, 'css', `${id}.css`);
        if (!existsSync(file)) writeFileSync(file, text);
        css.push(id);
      }
      const file = `${design}.json`;
      if (!cleared) {
        rmSync(pageDir, { recursive: true, force: true });
        mkdirSync(pageDir, { recursive: true });
        cleared = true;
      }
      writeFileSync(path.join(pageDir, file), JSON.stringify({ htmlAttrs: data.htmlAttrs, bodyAttrs: data.bodyAttrs, css, assets: [...assets].sort(), body: data.body }, null, 1));
      bodies.set(design, data.body);
      designs[design] = { status, file };
      meta ??= { title: data.title, url, finalUrl: finalUrl.replace(source.origin, '') };
      console.log(`✓ ${p.id.padEnd(24)} ${design.padEnd(15)} ${status} ${source.name}${source.principal ? ` as ${source.principal}` : ''} ${url}`);
    } catch (err) {
      failures.push(`${p.id} (${design}): ${err instanceof Error ? err.message : String(err)}`);
      console.error(`✗ ${p.id} ${design}: ${err instanceof Error ? err.message : String(err)}`);
      if (design === DESIGNS[0]) break;
    }
  }
  if (meta) {
    index.pages[p.id] = { ...meta, source: source.name === 'production' ? PRODUCTION : 'app (test server, fixture data)', principal: source.principal, capturedAt: new Date().toISOString().slice(0, 10), designs };
  }
}

writeFileSync(indexPath, `${JSON.stringify({ $comment: 'Written by npm run stages:capture (scripts/stages/capture.ts). Do not edit by hand.', ...index }, null, 1)}\n`);
await browser.close();
if (failures.length) {
  console.error(`\ncapture: ${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`\ncapture: ${ordered.length} pages → ${path.relative(ROOT, OUT)}/`);
