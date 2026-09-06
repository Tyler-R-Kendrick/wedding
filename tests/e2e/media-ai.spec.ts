import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiHeaders, CRON_SECRET, principalHeaders } from '../helpers/e2e-principals';

const execFileAsync = promisify(execFile);

const guest = principalHeaders({ kind: 'guest', guestId: 'E2EAIGUEST', householdId: 'E2EAIHOUSE', entitlements: ['upload_media', 'view_private_media', 'use_face_matching'] });
const aiAdmin = principalHeaders({ kind: 'admin', adminId: 'E2EAIADMIN', entitlements: ['admin_media', 'admin_ai', 'admin_lifecycle', 'upload_media'] });

/**
 * A dev server keeps its in-memory database between runs, and identical bytes are (correctly)
 * filed as an exact duplicate and kept out of the gallery. So each run gets its own colour and
 * its own word to search for.
 */
const ROLL = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x');
const CAPTION = `Sparklers on the front steps, roll ${ROLL}`;

/** One JPEG, built with sharp in a subprocess (the Playwright runner cannot load native modules). */
async function makeFixture(dir: string): Promise<string> {
  const file = path.join(dir, 'make.cjs');
  const tone = 30 + Math.floor(Math.random() * 200);
  await writeFile(
    file,
    `const sharp = require('sharp');
     sharp({ create: { width: 900, height: 600, channels: 3, background: { r: ${tone}, g: ${(tone + 37) % 256}, b: ${(tone + 91) % 256} } } })
       .jpeg({ quality: 80 })
       .withExif({ IFD0: { Make: 'Fixture', Model: 'FixtureCam' }, IFD2: { DateTimeOriginal: '2027:07:17 21:40:00' } })
       .toFile(process.argv[2])
       .then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });`,
  );
  const out = path.join(dir, 'sparklers.jpg');
  await execFileAsync(process.execPath, [file, out], { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: path.join(process.cwd(), 'node_modules') } });
  return out;
}

/**
 * One capability call. A webpack dev server under three parallel viewport projects will
 * occasionally answer an API route with the app's HTML 404 while it rebuilds its route manifest;
 * that is a dev artifact, not a product behaviour, so a non-JSON answer is retried rather than
 * asserted on. Against a production build the first attempt always answers.
 */
async function call<T>(request: APIRequestContext, baseURL: string, url: string, principal: Record<string, string>, input: unknown, extra: Record<string, unknown> = {}) {
  const body = { input, idempotencyKey: crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26), ...extra };
  let last = '';
  let status = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await request.post(url, { headers: apiHeaders(principal, baseURL), data: body });
    status = res.status();
    last = await res.text();
    if (last.trimStart().startsWith('{')) {
      return { status, ...(JSON.parse(last) as { ok: boolean; data?: T; error?: { code: string; message: string } }) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`POST ${baseURL}${url} kept answering ${status} with non-JSON: ${last.slice(0, 200)}`);
}

/**
 * A dev server compiles a route on its first request, and three viewport projects arrive at once.
 * Touch every endpoint and page this journey uses first, ignoring the answers, so a first compile
 * never lands in the middle of an assertion. Against a production build this is a no-op.
 */
async function warmRoutes(request: APIRequestContext) {
  // Until a route has compiled, the dev server answers the app's HTML 404 for it. Poll each one
  // until it replies as an API (any JSON body) before the journey starts.
  const apis = ['/api/uploads/create', '/api/uploads/complete', '/api/capabilities/search_media', '/api/capabilities/admin_moderate_media', '/api/biometrics/draft', '/api/biometrics/delete', '/api/uploads/jobs/run', '/api/media-ai/jobs/run'];
  for (const url of apis) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const body = await request
        .post(url, { headers: { 'Content-Type': 'application/json' }, data: {} })
        .then((r) => r.text())
        .catch(() => '');
      if (body.trimStart().startsWith('{')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  for (const url of ['/media/search', '/media/me', '/admin/ai', '/admin/biometrics']) {
    await request.get(url).catch(() => undefined);
  }
}

async function runMediaJobs(request: APIRequestContext, times = 4) {
  for (let i = 0; i < times; i++) {
    for (const url of ['/api/uploads/jobs/run', '/api/media-ai/jobs/run']) {
      const res = await request.post(url, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      expect(res.status(), `${url} must accept CRON_SECRET`).toBe(200);
    }
  }
}

test.describe('semantic search and the face-matching opt-in', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    // Compiling a dozen dev routes across three viewport projects takes longer than the default.
    test.setTimeout(240_000);
    await warmRoutes(request);
  });

  test('an uploaded, approved photo becomes findable by what a guest wrote about it', async ({ request, baseURL }) => {
    test.slow();
    const bytes = await readFile(await makeFixture(await mkdtemp(path.join(os.tmpdir(), 'wedding-e2e-ai-'))));

    const created = await call<{ uploads: { ok: boolean; ticket?: { uploadId: string; parts: { partNumber: number; url: string; headers: Record<string, string> }[] } }[] }>(
      request,
      baseURL!,
      '/api/uploads/create',
      guest,
      { files: [{ clientRef: 'a', filename: 'sparklers.jpg', contentType: 'image/jpeg', size: bytes.byteLength, caption: CAPTION }] },
    );
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const ticket = created.data!.uploads[0]!.ticket!;
    const part = ticket.parts[0]!;
    const put = await request.put(part.url, { headers: part.headers, data: bytes });
    expect(put.status()).toBe(200);
    const etag = (put.headers()['etag'] ?? '').replaceAll('"', '');

    const done = await call<{ assetId: string }>(request, baseURL!, '/api/uploads/complete', guest, { uploadId: ticket.uploadId, parts: [{ partNumber: part.partNumber, etag }] });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    const assetId = done.data!.assetId;

    await runMediaJobs(request);
    const approved = await call(request, baseURL!, '/api/capabilities/admin_moderate_media', aiAdmin, { assetIds: [assetId], action: 'approve' });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);

    // Processing, deriving and indexing are queued work: drive the cron alias until the photo is
    // searchable rather than assuming a fixed number of batches was enough.
    let search = await call<{ items: { id: string; matchedTerms: string[] }[] }>(request, baseURL!, '/api/capabilities/search_media', guest, { query: `sparklers roll ${ROLL}` });
    for (let attempt = 0; attempt < 12 && !(search.ok && search.data!.items.some((i) => i.id === assetId)); attempt++) {
      await runMediaJobs(request, 2);
      search = await call(request, baseURL!, '/api/capabilities/search_media', guest, { query: `sparklers roll ${ROLL}` });
    }
    expect(search.ok, JSON.stringify(search)).toBe(true);
    expect(search.data!.items.map((i) => i.id)).toContain(assetId);
    expect(search.data!.items[0]!.matchedTerms).toEqual(expect.arrayContaining(['sparklers', ROLL]));

    // Nothing invented: a query nothing answers comes back empty.
    const nothing = await call<{ items: unknown[] }>(request, baseURL!, '/api/capabilities/search_media', guest, { query: 'a snowstorm in the parking garage' });
    expect(nothing.ok && nothing.data!.items).toEqual([]);
  });

  test('the search page is usable from the keyboard and reports its results honestly', async ({ page, context }) => {
    // Anonymous first: the page works, and says which albums it is searching.
    await page.goto('/media/search');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search the photos');
    await expect(page.getByRole('main')).toContainText('searching the public albums');

    // The polite live region the results are announced through (the empty state is its own status).
    const announced = page.locator('p[role="status"]');
    await page.getByRole('button', { name: 'first dance' }).click();
    await expect(announced).toContainText('results for');

    // Signed in, the guest albums are searchable too.
    await context.setExtraHTTPHeaders(guest);
    await page.reload();
    const box = page.getByLabel('What are you looking for?');
    await box.fill(`sparklers roll ${ROLL}`);
    await box.press('Enter');
    // A warm dev server may hold earlier runs' photos, which also answer "sparklers"; this run's
    // own roll word is what puts its photo first.
    await expect(announced).toContainText(`for “sparklers roll ${ROLL}`);
    const first = page.locator('.mi-why > li').first();
    await expect(first).toContainText(CAPTION);
    await expect(first).toContainText('matched sparklers');
    await expect(first).toContainText('Described by the person who added it');

    await box.fill('a snowstorm in the parking garage');
    await box.press('Enter');
    await expect(announced).toContainText('0 results');
    await expect(page.getByRole('main')).toContainText('Nothing in the album matches that yet');

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  test('with biometrics off, the guest page says so and offers no opt-in at all', async ({ page, context, baseURL }) => {
    await context.setExtraHTTPHeaders(guest);
    await page.goto('/media/me');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Photos of me');
    const main = page.getByRole('main');
    await expect(main).toContainText('switched off');
    await expect(main).not.toContainText('biometric identifier');
    await expect(page.getByRole('button', { name: /agree/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    // Search is offered instead, and needs no permission from anyone.
    await expect(page.getByRole('link', { name: 'Search the photos' }).first()).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);

    // The consent endpoint refuses the opt-in, but deletion still works with the feature off.
    const draft = await context.request.post('/api/biometrics/draft', { headers: apiHeaders(guest, baseURL!), data: { input: { adultAttested: true } } });
    // feature_disabled is a 404: a switched-off feature does not advertise itself (ADR-0006 §1).
    expect(draft.status()).toBe(404);
    expect((await draft.json()).error.code).toBe('feature_disabled');
    const del = await context.request.post('/api/biometrics/delete', { headers: apiHeaders(guest, baseURL!), data: { input: {}, idempotencyKey: 'E2EAIDELETION0000000000000' } });
    expect(del.status(), await del.text()).toBe(200);
  });

  test('the admin pages report the index and the readiness gate', async ({ page, context }) => {
    await context.setExtraHTTPHeaders(aiAdmin);
    await page.goto('/admin/ai');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search index');
    await expect(page.getByRole('main')).toContainText('Indexable items');

    await page.getByRole('link', { name: 'Face matching' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Face matching');
    const main = page.getByRole('main');
    await expect(main).toContainText('privacy counsel');
    await expect(main).toContainText('readiness switch');
    // Turning it on is impossible without a counsel reference.
    const switchOn = page.getByRole('button', { name: 'Switch readiness on' });
    await expect(switchOn).toBeDisabled();

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });
});
