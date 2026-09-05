/**
 * Lab CLS / LCP at 390×844 under 4× CPU throttling and 1.6 Mbps / 150 ms, the conditions the
 * design review used. Requires a running server.
 *   node scripts/measure-cls.mjs http://localhost:3104/?theme=gilded-hour [more urls]
 */
import { existsSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node scripts/measure-cls.mjs <url> [url…]');
  process.exit(1);
}
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
for (const url of urls) {
  const context = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const { cls, lcp } = await page.evaluate(() => ({ cls: window.__cls, lcp: window.__lcp }));
  const smallest = await page.evaluate(() => {
    let min = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      if (!el.textContent?.trim() || el.children.length) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('dialog:not([open])') || el.classList.contains('sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      min = Math.min(min, parseFloat(cs.fontSize));
    }
    return min;
  });
  console.log(`${url}\n  CLS ${cls.toFixed(3)}  LCP ${Math.round(lcp)} ms  load ${Date.now() - started} ms  smallest visible text ${smallest.toFixed(2)} px`);
  await context.close();
}
await browser.close();
