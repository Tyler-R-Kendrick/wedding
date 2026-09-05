/**
 * Measures webfont vs metric-fallback widths for the strings that decide the fold at 390 and prints
 * the size-adjust each fallback face needs so the two render the same width (CLS < 0.05).
 *   node scripts/measure-fallbacks.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontsCss = ['gilded-hour', 'conservatory'].map((t) => readFileSync(path.join(ROOT, 'src/themes', t, 'fonts.css'), 'utf8')).join('\n');
const CASES = [
  { face: 'Cinzel', fallback: 'Cinzel Fallback', text: 'SARA + TYLER', css: 'font-size:46.75px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase' },
  { face: 'Cinzel', fallback: 'Cinzel Fallback', text: 'OUR ADVENTURES', css: 'font-size:34px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase' },
  { face: 'Josefin Sans', fallback: 'Josefin Sans Fallback', text: 'Chicago Athletic Association Hotel, Chicago', css: 'font-size:19.125px;font-weight:400' },
  { face: 'Josefin Sans', fallback: 'Josefin Sans Fallback', text: 'We are inviting the people we love into the places, adventures, and memories that made us.', css: 'font-size:19.125px;font-weight:400' },
  { face: 'Big Shoulders Display', fallback: 'Big Shoulders Display Fallback', text: '07 · 17 · 27', css: 'font-size:34px;font-weight:600;letter-spacing:0.02em' },
  { face: 'Gloock', fallback: 'Gloock Fallback', text: 'Sara + Tyler', css: 'font-size:51px;font-weight:400' },
  { face: 'Spectral', fallback: 'Spectral Fallback', text: 'We are inviting the people we love into the places, adventures, and memories that made us.', css: 'font-size:18.0625px;font-weight:400' },
  { face: 'Cardo', fallback: 'Cardo Fallback', text: 'Chicago Athletic Association Hotel, Chicago', css: 'font-size:17px;font-style:italic' },
];
const html = `<!doctype html><html><head><style>${fontsCss} body{margin:0} span{white-space:nowrap;display:inline-block}</style></head><body>${CASES.map((c, i) => `<span id="w${i}" style="font-family:'${c.face}';${c.css}">${c.text}</span><br><span id="f${i}" style="font-family:'${c.fallback}';${c.css}">${c.text}</span><br>`).join('')}</body></html>`;
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/measure.html') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  const local = path.join(ROOT, 'public', url.pathname);
  if (existsSync(local)) return route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(local) });
  return route.fulfill({ status: 404, body: '' });
});
await page.goto('http://render.local/measure.html');
await page.evaluate(() => document.fonts.ready);
const sizes = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
  const w = document.getElementById(`w${i}`).getBoundingClientRect();
  const f = document.getElementById(`f${i}`).getBoundingClientRect();
  return { w: w.width, wh: w.height, f: f.width, fh: f.height };
}), CASES.length);
const current = Object.fromEntries([...fontsCss.matchAll(/font-family: "([^"]+ Fallback)";[\s\S]*?size-adjust: ([\d.]+)%/g)].map((m) => [m[1], Number(m[2])]));
for (const [i, c] of CASES.entries()) {
  const s = sizes[i];
  const ratio = s.w / s.f;
  console.log(`${c.face.padEnd(22)} "${c.text.slice(0, 32)}"  web ${s.w.toFixed(1)}px  fallback ${s.f.toFixed(1)}px  ratio ${ratio.toFixed(4)}  current size-adjust ${current[c.fallback]}%  suggested ${(current[c.fallback] * ratio).toFixed(2)}%  (heights ${s.wh.toFixed(1)} / ${s.fh.toFixed(1)})`);
}
await browser.close();
