/**
 * Script bytes and requests for the first view of a route. Run against `next start` only.
 *
 * `node scripts/probes/bundle.mjs <route...>`
 *
 * A fresh browser context per route, because a second navigation in the same context serves cached
 * scripts and Playwright reports `responseBodySize: -1` for those. NOT `content-length`: `next start`
 * serves chunked and does not send it, which is how the first version of `tests/e2e/bundle.spec.ts`
 * summed 0kB against a 400kB budget and reported green.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3316';
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
for (const path of process.argv.slice(2)) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const scripts = new Map();
  page.on('response', (res) => {
    const url = res.url();
    if (!/\.js(\?|$)/.test(url) || scripts.has(url)) return;
    scripts.set(url, res.request().sizes().then((s) => s.responseBodySize).catch(() => 0));
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  const sizes = await Promise.all([...scripts.values()]);
  console.log(`${path}: ${scripts.size} scripts, ${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)}kB on the wire`);
  await ctx.close();
}
await browser.close();
