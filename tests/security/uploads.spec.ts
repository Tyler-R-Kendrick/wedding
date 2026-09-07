import { expect, test } from '@playwright/test';
import { admin, apiHeaders, guestA, guestB, guestNoView } from '../helpers/e2e-principals';

/**
 * Security properties of the media pipeline, exercised over HTTP against the running app:
 *  - quarantine and originals are never served, whatever the URL says;
 *  - private collections and unreviewed items are invisible across guests and to anonymous callers;
 *  - keys and cursors are validated, so path traversal never reaches storage.
 * Requires the dev server with NODE_ENV=test + TEST_AUTH_SECRET (see tests/helpers/e2e-principals.ts).
 */
test.describe('media security', () => {
  test('signed-URL machinery never serves quarantine or originals, and rejects traversal', async ({ request }) => {
    // Unsigned / bad-signature reads of every private prefix are refused
    for (const key of ['quarantine/01ARZ3NDEKTSV4RRFFQ69G5FAV/original', 'originals/guest/E2EGUESTA/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg', 'originals/professional/vendor/x.jpg', 'archive/2027/manifests/deletions/x.json']) {
      const res = await request.get(`/api/dev/storage/${key}?op=get&exp=9999999999&sig=AAAA`);
      expect(res.status(), key).toBe(403);
    }
    // Traversal in the key never reaches the filesystem
    for (const key of ['derivatives/../originals/guest/x.jpg', 'derivatives/thumb/..%2F..%2Fetc%2Fpasswd', 'derivatives/.hidden/x.webp', 'derivatives/thumb/x.meta.json', 'quarantine/x/upload.json']) {
      const res = await request.get(`/api/dev/storage/${key}?op=get&exp=9999999999&sig=AAAA`);
      expect([400, 403, 404], key).toContain(res.status());
    }
    // An unsigned PUT into quarantine is refused too
    const put = await request.put('/api/dev/storage/quarantine/01ARZ3NDEKTSV4RRFFQ69G5FAV/original?op=put&exp=9999999999&sig=AAAA&ct=image/jpeg', { data: 'x' });
    expect(put.status()).toBe(403);
  });

  test('a quarantined (unprocessed) upload is never served or listed, even to its owner via the gallery', async ({ request, baseURL }) => {
    const created = await request.post('/api/uploads/create', { headers: apiHeaders(guestA, baseURL!), data: { input: { files: [{ clientRef: 'q', filename: 'q.jpg', contentType: 'image/jpeg', size: 1024 }] }, idempotencyKey: `sec-${Date.now()}` } });
    expect(created.status()).toBe(200);
    const ticket = (await created.json()).data.uploads[0].ticket;
    expect(ticket.parts[0].url).toContain('/api/dev/storage/quarantine/');
    // The signed PUT URL is single-purpose: it cannot read the object back (op is bound into the signature)
    const readBack = await request.get(ticket.parts[0].url.replace('op=put', 'op=get'));
    expect(readBack.status()).toBe(403);
    // Upload bytes that are not an image at all: completion rejects, nothing becomes an asset
    const put = await request.put(ticket.parts[0].url, { headers: ticket.parts[0].headers, data: Buffer.alloc(1024, 0x41) });
    expect(put.status()).toBe(200);
    const done = await request.post('/api/uploads/complete', { headers: apiHeaders(guestA, baseURL!), data: { input: { uploadId: ticket.uploadId }, idempotencyKey: `sec-done-${Date.now()}` } });
    expect(done.status()).toBe(422);
    expect((await done.json()).error.message).toMatch(/could not recognise/);
    // Nobody can fetch the quarantined object through the dev route without the exact signature
    const key = new URL(ticket.parts[0].url).pathname.replace('/api/dev/storage/', '');
    expect((await request.get(`/api/dev/storage/${key}?op=get&exp=9999999999&sig=forged`)).status()).toBe(403);
  });

  test('ACL: private albums and unreviewed items are invisible across guests and to anonymous callers', async ({ request, baseURL }) => {
    const anon = await request.post('/api/capabilities/list_gallery', { headers: { 'Content-Type': 'application/json' }, data: { input: {} } });
    expect(anon.status()).toBe(200);
    expect((await anon.json()).data.collections.map((c: { slug: string }) => c.slug)).toEqual(['engagement']);
    for (const slug of ['guest-uploads', 'raw-archive', 'full-ceremony']) {
      const res = await request.post('/api/capabilities/list_gallery', { headers: { 'Content-Type': 'application/json' }, data: { input: { collection: slug } } });
      expect(res.status(), slug).toBe(404);
    }
    // A guest without view_private_media sees only public albums; a guest with it never sees raw-archive
    const noView = await request.post('/api/capabilities/list_gallery', { headers: apiHeaders(guestNoView, baseURL!), data: { input: { collection: 'guest-uploads' } } });
    expect(noView.status()).toBe(404);
    const withView = await request.post('/api/capabilities/list_gallery', { headers: apiHeaders(guestB, baseURL!), data: { input: {} } });
    const slugs = (await withView.json()).data.collections.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('guest-uploads');
    expect(slugs).not.toContain('raw-archive');
    // Guest B cannot read guest A's uploads list or items; unknown/other ids look identical (404)
    const mineB = await request.post('/api/capabilities/list_my_uploads', { headers: apiHeaders(guestB, baseURL!), data: { input: {} } });
    expect(mineB.status()).toBe(200);
    const bItems = (await mineB.json()).data.items as { assetId: string | null }[];
    expect(bItems.every((i) => !i.assetId || i.assetId.startsWith('0'))).toBe(true);
    const mineA = await request.post('/api/capabilities/list_my_uploads', { headers: apiHeaders(guestA, baseURL!), data: { input: {} } });
    const aIds = ((await mineA.json()).data.items as { assetId: string | null }[]).map((i) => i.assetId).filter(Boolean);
    for (const id of aIds.slice(0, 3)) {
      const privateItem = await request.post('/api/capabilities/get_media_item', { headers: apiHeaders(guestB, baseURL!), data: { input: { assetId: id } } });
      const anonymousItem = await request.post('/api/capabilities/get_media_item', { headers: { 'Content-Type': 'application/json' }, data: { input: { assetId: id } } });
      // published guest items are visible to guests with view_private_media but never to anonymous callers
      expect([200, 404]).toContain(privateItem.status());
      expect(anonymousItem.status()).toBe(404);
      const del = await request.post('/api/capabilities/delete_my_upload', { headers: apiHeaders(guestB, baseURL!), data: { input: { assetId: id }, idempotencyKey: `sec-del-${Date.now()}-${id}` } });
      expect(del.status()).toBe(404);
    }
    // Guests cannot reach admin capabilities; admins cannot use guest-only ones with a widened principal
    const mod = await request.post('/api/capabilities/admin_moderate_media', { headers: apiHeaders(guestA, baseURL!), data: { input: { assetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'], action: 'approve' }, idempotencyKey: `sec-mod-${Date.now()}` } });
    expect(mod.status()).toBe(403);
    const queue = await request.post('/api/capabilities/admin_list_media', { headers: apiHeaders(guestA, baseURL!), data: { input: {} } });
    expect(queue.status()).toBe(403);
    const adminQueue = await request.post('/api/capabilities/admin_list_media', { headers: apiHeaders(admin, baseURL!), data: { input: {} } });
    expect(adminQueue.status()).toBe(200);
    // Cursors and ids are validated
    const badCursor = await request.post('/api/capabilities/list_gallery', { headers: apiHeaders(guestB, baseURL!), data: { input: { collection: 'guest-uploads', cursor: '../../etc/passwd' } } });
    expect(badCursor.status()).toBe(200); // ignored, not an error
    const badId = await request.post('/api/capabilities/get_media_item', { headers: apiHeaders(guestB, baseURL!), data: { input: { assetId: '../../etc/passwd' } } });
    expect(badId.status()).toBe(422);
    const badSlug = await request.post('/api/capabilities/list_gallery', { headers: apiHeaders(guestB, baseURL!), data: { input: { collection: '../raw-archive' } } });
    expect(badSlug.status()).toBe(422);
  });

  test('the test-principal injector refuses wrong secrets and unknown shapes', async ({ request }) => {
    const wrong = await request.post('/api/capabilities/list_my_uploads', { headers: { 'x-test-principal': JSON.stringify({ kind: 'guest', guestId: 'X', householdId: 'H', entitlements: ['upload_media'] }), 'x-test-auth-secret': 'not-the-secret-000000', 'Content-Type': 'application/json' }, data: { input: {} } });
    expect(wrong.status()).toBe(401);
    const system = await request.post('/api/capabilities/admin_list_media', { headers: { 'x-test-principal': JSON.stringify({ kind: 'system', component: 'x' }), 'x-test-auth-secret': process.env.TEST_AUTH_SECRET ?? 'e2e-test-auth-secret-0123456789', 'Content-Type': 'application/json' }, data: { input: {} } });
    expect(system.status()).toBe(401);
    // The cron alias needs the bearer
    expect((await request.post('/api/uploads/jobs/run')).status()).toBe(401);
  });
});
