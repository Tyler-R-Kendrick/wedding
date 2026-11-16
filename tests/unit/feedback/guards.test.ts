import { describe, expect, it } from 'vitest';
import { fallbackForm, fallbackThanks, safeFrom } from '@/lib/feedback/fallback-page';
import { fromThisSite, MemoryWindow, readCapped } from '@/lib/feedback/guards';

const request = (headers: Record<string, string>, url = 'https://kendrick.wedding/api/feedback') => new Request(url, { method: 'POST', headers });

describe('fromThisSite', () => {
  it('believes the browser when it says so', () => {
    expect(fromThisSite(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(fromThisSite(request({ 'sec-fetch-site': 'cross-site', origin: 'https://kendrick.wedding' }))).toBe(false);
    expect(fromThisSite(request({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(fromThisSite(request({ 'sec-fetch-site': 'none' }))).toBe(false);
  });

  it('falls back to comparing Origin with the host being asked', () => {
    expect(fromThisSite(request({ origin: 'https://kendrick.wedding', host: 'kendrick.wedding' }))).toBe(true);
    expect(fromThisSite(request({ origin: 'https://evil.example', host: 'kendrick.wedding' }))).toBe(false);
    expect(fromThisSite(request({ origin: 'not a url', host: 'kendrick.wedding' }))).toBe(false);
  });

  it('refuses a request that says nothing about where it came from', () => {
    expect(fromThisSite(request({}))).toBe(false);
  });
});

describe('MemoryWindow', () => {
  it('allows the limit inside the window, then refuses, then recovers', () => {
    const window = new MemoryWindow(2, 1_000);
    expect(window.allow('a', 0)).toBe(true);
    expect(window.allow('a', 10)).toBe(true);
    expect(window.allow('a', 20)).toBe(false);
    expect(window.allow('b', 20)).toBe(true);
    expect(window.allow('a', 1_011)).toBe(true);
  });

  it('forgets the least recently seen key rather than growing without bound', () => {
    const window = new MemoryWindow(1, 1_000, 2);
    window.allow('a', 0);
    window.allow('b', 1);
    window.allow('c', 2);
    // `a` was evicted, so it is allowed again; `c` is still remembered.
    expect(window.allow('a', 3)).toBe(true);
    expect(window.allow('c', 4)).toBe(false);
  });
});

describe('readCapped', () => {
  const body = (bytes: number, headers: Record<string, string> = {}) => new Request('https://kendrick.wedding/x', { method: 'POST', body: new Uint8Array(bytes), headers });

  it('reads a body inside the cap', async () => {
    expect((await readCapped(body(10), 100))?.byteLength).toBe(10);
  });

  it('refuses on the declared length without reading, and on the real length when that lies', async () => {
    expect(await readCapped(body(10, { 'content-length': '1000' }), 100)).toBeNull();
    expect(await readCapped(body(1_000), 100)).toBeNull();
  });
});

describe('the plain form', () => {
  it('is one document with no script and no stylesheet', () => {
    const html = fallbackForm({ from: '/rsvp' });
    expect(html).not.toMatch(/<script|<link|@import/i);
    expect(html).toContain('<form method="post" action="/api/feedback" enctype="multipart/form-data">');
    expect(html).toContain('<label for="message">What happened?</label>');
    expect(html).toContain('name="path" value="/rsvp"');
  });

  it('escapes everything it is given', () => {
    const html = fallbackForm({ from: '/"><script>x</script>', error: '<b>bad</b>', message: '</textarea><script>y</script>', digest: '"onload="z' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;/textarea&gt;');
    expect(fallbackThanks({ ref: 'FB-<x>', where: '<i>', from: '/' })).not.toMatch(/<x>|<i>/);
  });

  it('only ever links back to a path on this site', () => {
    expect(safeFrom('/rsvp/step?x=1#y')).toBe('/rsvp/step');
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', '', null, undefined]) expect(safeFrom(bad)).toBe('');
  });
});
