import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { admin, apiHeaders, CRON_SECRET, guestA, guestB } from '../helpers/e2e-principals';

const execFileAsync = promisify(execFile);

/** Fixtures are generated with sharp in a subprocess (Playwright's test runner cannot load native modules directly). */
async function makeFixtures(dir: string): Promise<{ small: string; big: string; gps: string; mp4: string }> {
  const script = `
    const sharp = require('sharp');
    const fs = require('node:fs');
    const path = require('node:path');
    const { buildSyntheticMp4 } = require('tsx/cjs/api').require('${path.resolve(process.cwd(), 'src/lib/media/mp4.ts').replace(/\\\\/g, '/')}', __filename);
    (async () => {
      const dir = process.argv[2];
      const noise = (w, h) => { const b = Buffer.alloc(w * h * 3); let x = 987654321; for (let i = 0; i < b.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 255; } return b; };
      const exif = { IFD0: { Make: 'Fixture', Model: 'FixtureCam' }, IFD2: { DateTimeOriginal: '2027:07:17 18:30:00' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 52/1 55/1', GPSLongitudeRef: 'W', GPSLongitude: '87/1 37/1 27/1', GPSVersionID: '2 3 0 0' } };
      await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 60, g: 120, b: 180 } } }).jpeg({ quality: 80 }).withExif(exif).toFile(path.join(dir, 'small.jpg'));
      await sharp(noise(1600, 1100), { raw: { width: 1600, height: 1100, channels: 3 } }).jpeg({ quality: 100 }).withExif(exif).toFile(path.join(dir, 'big.jpg'));
      await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg({ quality: 85 }).withExif(exif).toFile(path.join(dir, 'phone-photo.jpg'));
      fs.writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from(buildSyntheticMp4({ location: '+41.8789-087.6243/', durationSeconds: 3, width: 640, height: 360, mdatBytes: 4096 })));
      console.log('ok');
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const file = path.join(dir, 'make.cjs');
  await writeFile(file, script);
  // The script lives in a temp dir: point CJS resolution at the project's node_modules.
  await execFileAsync(process.execPath, [file, dir], { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: path.join(process.cwd(), 'node_modules') } });
  return { small: path.join(dir, 'small.jpg'), big: path.join(dir, 'big.jpg'), gps: path.join(dir, 'phone-photo.jpg'), mp4: path.join(dir, 'clip.mp4') };
}

/**
 * Dev servers compile routes on first hit and push webpack hot updates to open tabs; when other
 * projects trigger a first compile while a file is mid-upload, the tab may be fully reloaded (a
 * dev-only artifact). Warm every route this journey and its neighbours touch, then wait until no
 * hot update has arrived for a few seconds. Against a production build this is a no-op.
 */
async function warmRoutes(page: import('@playwright/test').Page, request: APIRequestContext) {
  let lastHot = Date.now();
  const onRequest = (r: import('@playwright/test').Request) => {
    if (r.url().includes('hot-update')) lastHot = Date.now();
  };
  page.on('request', onRequest);
  for (const route of ['/', '/photos', '/photos/guest-uploads', '/media/mine', '/admin/media', '/admin/media/duplicates', '/admin/media/import', '/admin/media/metrics', '/media/upload']) {
    await page.goto(route, { waitUntil: 'networkidle' });
  }
  for (const path of ['/api/uploads/create', '/api/uploads/resume', '/api/uploads/complete', '/api/uploads/abort', '/api/uploads/jobs/run', '/api/capabilities/list_my_uploads', '/api/capabilities/get_media_item', '/api/capabilities/admin_moderate_media', '/api/capabilities/admin_media_metrics']) {
    await request.post(path, { headers: { 'Content-Type': 'application/json' }, data: {} }).catch(() => undefined);
  }
  await request.get('/api/dev/storage/derivatives/thumb/warm.webp?op=get&exp=1&sig=x').catch(() => undefined);
  await request.get('/api/health').catch(() => undefined);
  const settleMs = 4_000;
  const deadline = Date.now() + 60_000;
  for (;;) {
    await page.waitForTimeout(500);
    if (Date.now() - lastHot > settleMs) break;
    if (Date.now() > deadline) break;
  }
  page.off('request', onRequest);
}

async function runJobs(request: APIRequestContext, times = 3) {
  for (let i = 0; i < times; i++) {
    const res = await request.post('/api/uploads/jobs/run', { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status(), 'media cron alias must accept CRON_SECRET').toBe(200);
  }
}

test.describe('guest QR upload → resume → admin approve → gallery', () => {
  test.describe.configure({ mode: 'serial' });
  let fixtures: Awaited<ReturnType<typeof makeFixtures>>;

  test.beforeAll(async () => {
    fixtures = await makeFixtures(await mkdtemp(path.join(os.tmpdir(), 'wedding-e2e-')));
  });

  test('anonymous visitors are asked to sign in and see only public albums', async ({ page }) => {
    await page.goto('/media/upload');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add your photos and videos');
    await expect(page.getByRole('heading', { name: 'Please sign in first' })).toBeVisible();
    await page.goto('/photos');
    await expect(page.getByRole('link', { name: 'Engagement' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'From our guests' })).toHaveCount(0);
  });

  test('mobile guest uploads a batch with an interruption, resumes, and sees processing states', async ({ browser }) => {
    test.skip(test.info().project.name !== 'mobile', 'the upload journey runs on the phone profile');
    test.setTimeout(300_000);
    const context = await browser.newContext({ ...test.info().project.use, extraHTTPHeaders: guestA });
    const page = await context.newPage();
    if (process.env.E2E_DEBUG) {
      const t0 = Date.now();
      const log = (m: string) => console.log(`[e2e ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
      page.on('request', (r) => log(`REQ ${r.method()} ${new URL(r.url()).pathname}${/op=|partNumber/.test(r.url()) ? '?' + new URL(r.url()).search.slice(1, 40) : ''}`));
      page.on('requestfailed', (r) => log(`FAILED ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
      page.on('response', (r) => { if (r.status() >= 400) log(`RESP ${r.status()} ${new URL(r.url()).pathname}`); });
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`console.${m.type()}: ${m.text().slice(0, 200)}`); });
      page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) log(`NAVIGATED ${f.url()}`); });
    }
    // Interrupt: the first two attempts of any multipart part 2 PUT fail at the network layer.
    let failures = 0;
    await page.route(/\/api\/dev\/storage\/quarantine\/.*partNumber=2/, async (route) => {
      if (failures < 2) {
        failures++;
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    await warmRoutes(page, context.request);
    await page.goto('/media/upload');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add your photos and videos');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), axe.violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);

    await page.getByLabel('Choose photos or videos').setInputFiles([fixtures.small, fixtures.big, fixtures.mp4]);
    const rows = page.getByTestId('upload-row');
    await expect(rows).toHaveCount(3);
    // Every file ends up uploaded (the interrupted one recovered through automatic retries + resume)
    await expect(page.getByTestId('upload-status').filter({ hasText: /Awaiting review|Checking and preparing/ })).toHaveCount(3, { timeout: 60_000 });
    expect(failures).toBe(2);

    // Simulate a harder interruption: fail every attempt for a new file, then resume manually.
    let block = true;
    await page.route(/\/api\/dev\/storage\/quarantine\/.*op=put/, async (route) => (block ? route.abort('connectionreset') : route.continue()));
    await page.getByLabel('Choose photos or videos').setInputFiles([fixtures.gps]);
    const gpsRow = rows.filter({ hasText: 'phone-photo.jpg' });
    await expect(gpsRow.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
    block = false;
    await gpsRow.getByRole('button', { name: 'Retry' }).click();
    await expect(gpsRow.getByTestId('upload-status')).toHaveText(/Awaiting review|Checking and preparing/, { timeout: 30_000 });

    // Process the queue and watch the page settle into "Awaiting review"
    await runJobs(context.request, 4);
    await expect(page.getByTestId('upload-status').filter({ hasText: 'Awaiting review' })).toHaveCount(4, { timeout: 30_000 });
    await expect(page.getByTestId('upload-summary')).toContainText('4 done');

    // My uploads lists them with plain-language states; no coordinates, capture metadata or original keys leak into the page
    await page.goto('/media/mine');
    const mine = page.getByTestId('my-upload');
    await expect(mine).toHaveCount(4);
    await expect(page.getByText('Awaiting review').first()).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/41\.88|87\.62|latitude|longitude|FixtureCam|originals\//i);
    // Not visible in the guest gallery yet (private until approved)
    await page.goto('/photos/guest-uploads');
    await expect(page.getByRole('status')).toContainText('Nothing here yet');
    await context.close();
  });

  test('admin approves in bulk; the gallery shows the items to guests, with lightbox and stripped derivatives', async ({ browser, baseURL }) => {
    // Projects run concurrently against one in-memory database: the stateful journey stays on the phone profile.
    test.skip(test.info().project.name !== 'mobile', 'continues the phone journey');
    test.setTimeout(120_000);
    const adminCtx = await browser.newContext({ ...test.info().project.use, extraHTTPHeaders: admin });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto('/admin/media');
    await expect(adminPage.getByRole('heading', { level: 1 })).toHaveText('Media queue');
    const items = adminPage.getByTestId('queue-item');
    await expect(items).toHaveCount(4, { timeout: 15_000 });
    await expect(adminPage.getByText('location removed').first()).toBeVisible();
    await adminPage.getByLabel('Select all').check();
    await adminPage.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(adminPage.getByRole('status')).toContainText('Approve and publish: 4 done');
    await expect(items).toHaveCount(0);
    const metrics = await adminCtx.request.post('/api/capabilities/admin_media_metrics', { headers: apiHeaders(admin, baseURL!), data: { input: {} } });
    expect(metrics.status()).toBe(200);
    expect((await metrics.json()).data.approximate).toBe(true);
    await adminCtx.close();

    // Another signed-in guest now sees the published items in the album
    const guestCtx = await browser.newContext({ ...test.info().project.use, extraHTTPHeaders: guestB });
    const guestPage = await guestCtx.newPage();
    await guestPage.goto('/photos/guest-uploads');
    const tiles = guestPage.getByTestId('gallery-grid').getByRole('button');
    await expect(tiles.first()).toBeVisible({ timeout: 15_000 });
    const count = await tiles.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const axe = await new AxeBuilder({ page: guestPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), axe.violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
    // Thumbnails are signed derivative URLs, never originals; the served bytes carry no EXIF
    const src = await tiles.first().locator('img').getAttribute('src');
    expect(src).toContain('/api/dev/storage/derivatives/thumb/');
    const served = await guestCtx.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-security-policy']).toBe('sandbox');
    const body = await served.body();
    expect(body.includes(Buffer.from('Exif'))).toBe(false);
    // Lightbox: open, navigate, close returns focus
    await tiles.first().click();
    const dialog = guestPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/1 of \d+/)).toBeVisible();
    if (count > 1) {
      await dialog.getByRole('button', { name: 'Next' }).click();
      await expect(dialog.getByText(/2 of \d+/)).toBeVisible();
    }
    await guestPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await guestCtx.close();
  });
});
