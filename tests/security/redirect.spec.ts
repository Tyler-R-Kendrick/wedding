import { test, expect } from '@playwright/test';
import { BASE_URL, principalHeaders } from '../e2e/helpers/principal';

/*
 * Principals come from identity's test-principal injector rather than swarm G's
 * `wedding-dev-principal` cookie, which is deleted at this integration. The allowlist case below
 * also loses its `test.skip`: it asserts 422 specifically — a validation rejection, not an
 * authorization one — so it was written well enough to fail rather than pass on an unauthenticated
 * call, but behind the skip it simply did not run.
 */
const headers = (name?: 'A1' | 'admin') => ({ ...(name ? principalHeaders(name) : {}), origin: BASE_URL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
const PARTNER_HOSTS = /(^|\.)(uber\.com|zola\.com|theknot\.com|withjoy\.com|google\.com|apple\.com|opentable\.com|resy\.com|chicagoathletichotel\.com|hyatt\.com)$/;
const EVIL = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://www.zola.com/', 'https://evil.example/', 'https://zola.com.evil.example/', 'https://www.google.com/search?q=x', 'https://user:pw@www.zola.com/', '//evil.example/'];

/** Open-redirect: every outbound link a guest can obtain is https on an allowlisted host; nothing an admin (or a tampered row) enters can change that. */
test.describe('redirect allowlist', () => {
  test('handoff capabilities only ever return partner hosts, and unknown ids never leak a URL', async ({ request }) => {
    for (const name of ['list_gift_links', 'get_reservation_options']) {
      const res = await request.post(`/api/capabilities/${name}`, { data: { input: {} } });
      expect(res.status()).toBe(200);
      const text = await res.text();
      for (const m of text.matchAll(/"url":"([^"]+)"/g)) {
        const url = m[1]!;
        if (url.startsWith('/')) continue; // internal citation routes
        expect(url.startsWith('https://'), url).toBe(true);
        expect(new URL(url).hostname, url).toMatch(PARTNER_HOSTS);
      }
    }
    const gift = await request.post('/api/capabilities/open_gift_link', { data: { input: { linkId: 'registry-placeholder' } } });
    expect(gift.status()).toBe(200);
    expect(new URL((await gift.json()).handoffUrl).hostname).toMatch(PARTNER_HOSTS);
    for (const linkId of ['nope', '../../etc/passwd', 'javascript:alert(1)', 'https://evil.example']) {
      const res = await request.post('/api/capabilities/open_gift_link', { data: { input: { linkId } } });
      expect([404, 422], linkId).toContain(res.status());
      expect(await res.text()).not.toContain('evil');
    }
    const unavailable = await request.post('/api/capabilities/open_reservation_link', { data: { input: { venueId: 'placeholder-restaurant' } } });
    expect(unavailable.status()).toBe(200);
    const body = await unavailable.json();
    expect(body.handoffUrl).toBeUndefined();
    expect(body.data.rung).toBe('unavailable');
  });

  test('the capability route never redirects', async ({ request }) => {
    const res = await request.post('/api/capabilities/open_gift_link', { data: { input: { linkId: 'registry-placeholder' } }, maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['location']).toBeUndefined();
  });

  test('admin-entered links must pass the allowlist (javascript:, data:, http, foreign and lookalike hosts are rejected)', async ({ request }) => {
    const stamp = Date.now();
    for (const [i, url] of EVIL.entries()) {
      const gift = await request.post('/api/capabilities/admin_upsert_gift_link', { headers: headers('admin'), data: { input: { id: `evil-${stamp}`, kind: 'registry', provider: 'custom', label: 'x', url }, idempotencyKey: `redir-g-${stamp}-${i}` } });
      expect(gift.status(), url).toBe(422);
      const venue = await request.post('/api/capabilities/admin_upsert_reservation_venue', { headers: headers('admin'), data: { input: { id: `evil-${stamp}`, name: 'x', url }, idempotencyKey: `redir-v-${stamp}-${i}` } });
      expect(venue.status(), url).toBe(422);
    }
    const list = await request.post('/api/capabilities/list_gift_links', { data: { input: {} } });
    expect(await list.text()).not.toContain('evil');
    const guestAttempt = await request.post('/api/capabilities/admin_upsert_gift_link', { headers: headers('A1'), data: { input: { id: `g-${stamp}`, kind: 'registry', provider: 'zola', label: 'x', url: 'https://www.zola.com/' }, idempotencyKey: `redir-guest-${stamp}` } });
    expect(guestAttempt.status()).toBe(403);
  });
});
