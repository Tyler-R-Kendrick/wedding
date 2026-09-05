/**
 * Screenshots the harness HTML (scripts/render-home.tsx) at 390 / 768 / 1440, serving /fonts and
 * /assets from public/ through a request route so no server is needed.
 *
 *   node scripts/screenshot-home.mjs [--in .impeccable/review/html] [--out .impeccable/review] [--reduced]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const IN = path.resolve(ROOT, opt('in', '.impeccable/review/html'));
const OUT = path.resolve(ROOT, opt('out', '.impeccable/review'));
const REDUCED = args.includes('--reduced');
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
];
const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.html': 'text/html' };

const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const date = new Date().toISOString().slice(0, 10);
for (const file of readdirSync(IN).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(path.join(IN, file), 'utf8');
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: REDUCED ? 'reduce' : 'no-preference', deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'render.local') return route.abort();
      if (url.pathname === '/page.html') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      const local = path.join(ROOT, 'public', url.pathname);
      if (existsSync(local)) return route.fulfill({ status: 200, contentType: MIME[path.extname(local)] ?? 'application/octet-stream', body: readFileSync(local) });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://render.local/page.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(REDUCED ? 300 : 1600);
    const out = path.join(OUT, `${date}-${file.replace(/\.html$/, '')}-${vp.name}${REDUCED ? '-reduced' : ''}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`wrote ${path.relative(ROOT, out)}`);
    await context.close();
  }
}
await browser.close();
