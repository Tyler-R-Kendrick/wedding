import { describe, expect, it } from 'vitest';
import { buildTelemetryFixtures, TELEMETRY_FIXTURE_MESSAGE_PREFIX, TELEMETRY_FIXTURE_SESSION_PREFIX } from '@/db/seed/telemetry-fixtures';
import { cleanEvent, trafficBuckets } from '@/domain/ops/telemetry';
import { browserFamily, deviceClass, errorFingerprint, isSessionId, sanitizeMessage, sanitizeName, sanitizePath, sanitizeStack, topFrame } from '@/domain/ops/telemetry-sanitize';
import { parseServerEnv } from '@/lib/env';
import { telemetryEnabled } from '@/lib/telemetry';

describe('sanitizePath', () => {
  it('keeps the pathname and nothing else', () => {
    expect(sanitizePath('/our-story')).toBe('/our-story');
    expect(sanitizePath('/guests/travel?from=ORD&code=abc#plan')).toBe('/guests/travel');
    expect(sanitizePath('/#top')).toBe('/');
    expect(sanitizePath('https://kendrick.wedding/rsvp/attending?step=2')).toBe('/rsvp/attending');
    expect(sanitizePath('/rsvp/')).toBe('/rsvp');
    expect(sanitizePath('//our-story//')).toBe('/our-story');
  });

  it('collapses every route whose path is the secret', () => {
    expect(sanitizePath('/i/Zk9xQ2pLd0VyVHlVaU9w')).toBe('/i/[token]');
    expect(sanitizePath('/i/short')).toBe('/i/[token]');
    expect(sanitizePath('/i/abc/extra?x=1')).toBe('/i/[token]/extra');
    expect(sanitizePath('/invite/abc123')).toBe('/invite/[token]');
    expect(sanitizePath('/s/fixtureslug01')).toBe('/s/[slug]');
    expect(sanitizePath('/api/dev/storage/guest/photos/one.jpg')).toBe('/api/dev/storage/[key]');
    // Pages that merely start with the same letters are untouched.
    expect(sanitizePath('/sign-in')).toBe('/sign-in');
    expect(sanitizePath('/invite')).toBe('/invite');
    expect(sanitizePath('/i')).toBe('/i');
  });

  it('replaces opaque ids and anything that names a person, and keeps slugs', () => {
    expect(sanitizePath('/admin/content/story_sections/01JABCDEFGHJKMNPQRSTVWXYZ0')).toBe('/admin/content/story_sections/[id]');
    expect(sanitizePath('/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('/x/[id]');
    expect(sanitizePath('/x/1234567')).toBe('/x/[id]');
    expect(sanitizePath('/x/ada.testhouse@example.test')).toBe('/x/[redacted]');
    expect(sanitizePath('/x/ada%40example.test')).toBe('/x/[redacted]');
    expect(sanitizePath('/guests/things-to-do/starved-rock-state-park')).toBe('/guests/things-to-do/starved-rock-state-park');
    expect(sanitizePath('/our-venue/white-city-ballroom')).toBe('/our-venue/white-city-ballroom');
  });

  it('drops the prerendered tree prefix so one page has one path', () => {
    expect(sanitizePath('/t/botanical-deco/our-story')).toBe('/our-story');
    expect(sanitizePath('/t/botanical-deco')).toBe('/');
  });

  it('never returns something that is not a path', () => {
    expect(sanitizePath(undefined)).toBe('/');
    expect(sanitizePath('')).toBe('/');
    expect(sanitizePath('javascript:alert(1)')).toBe('/');
    expect(sanitizePath('our-story')).toBe('/');
    expect(sanitizePath(`/${'a'.repeat(500)}`)).toHaveLength(200);
    expect(sanitizePath('/a b\n/c')).toBe('/ab/c');
  });
});

describe('sanitizeMessage', () => {
  it('redacts emails, tokens, long numbers and phone numbers', () => {
    expect(sanitizeMessage('No guest for ada.testhouse@example.test')).toBe('No guest for [email]');
    expect(sanitizeMessage('bad token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 here')).toBe('bad token [redacted] here');
    expect(sanitizeMessage('order 123456789 failed')).toBe('order [number] failed');
    expect(sanitizeMessage('call +1 (555) 123-4567 now')).toBe('call [number] now');
    // Short numbers are what makes a message useful.
    expect(sanitizeMessage('Minified React error #418')).toBe('Minified React error #418');
  });

  it('reduces a URL to its sanitised path', () => {
    expect(sanitizeMessage('Failed to fetch https://kendrick.wedding/i/SECRETSECRET?code=999999')).toBe('Failed to fetch /i/[token]');
    expect(sanitizeMessage('Loading chunk failed (https://kendrick.wedding/_next/static/chunks/app.js)')).toBe('Loading chunk failed (/_next/static/chunks/app.js)');
  });

  it('is one line of at most 300 characters', () => {
    expect(sanitizeMessage('a\n  b\t c')).toBe('a b c');
    expect(sanitizeMessage('x'.repeat(1000))).toHaveLength(300);
    expect(sanitizeMessage(42)).toBe('');
  });
});

describe('sanitizeName', () => {
  it('accepts an identifier and nothing else', () => {
    expect(sanitizeName('TypeError')).toBe('TypeError');
    expect(sanitizeName('ChunkLoadError')).toBe('ChunkLoadError');
    expect(sanitizeName('ada@example.test')).toBeNull();
    expect(sanitizeName('<script>')).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
  });
});

describe('sanitizeStack', () => {
  const chrome = [
    'TypeError: Cannot read properties of undefined (reading "x")',
    '    at TripPlanner (https://kendrick.wedding/_next/static/chunks/trip.js?v=abc:12:345)',
    '    at https://kendrick.wedding/i/SECRETSECRETSECRET?code=1:1:2',
    ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (https://kendrick.wedding/_next/static/chunks/react.js:1:${i})`),
  ].join('\n');

  it('keeps at most eight frames, without hosts, query strings or tokens', () => {
    const stack = sanitizeStack(chrome)!;
    const lines = stack.split('\n');
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe('at TripPlanner (/_next/static/chunks/trip.js:12:345)');
    expect(lines[1]).toBe('at /i/[token]:1:2');
    expect(stack).not.toContain('kendrick.wedding');
    expect(stack).not.toContain('SECRET');
    expect(stack).not.toContain('?');
    // The first line repeats the message, which is stored (redacted) on its own.
    expect(stack).not.toContain('Cannot read');
  });

  it('reads Firefox and Safari frames, and removes the server root', () => {
    expect(sanitizeStack('render@https://kendrick.wedding/_next/a.js:1:2\n@https://kendrick.wedding/_next/b.js:3:4')).toBe('render@/_next/a.js:1:2\n@/_next/b.js:3:4');
    expect(sanitizeStack('Error: x\n    at Page (/var/task/.next/server/app/page.js:1:2)', { root: '/var/task' })).toBe('at Page (/.next/server/app/page.js:1:2)');
  });

  it('is at most 2000 characters and null when there is nothing to keep', () => {
    const long = Array.from({ length: 8 }, (_, i) => `    at ${'f'.repeat(400)}${i} (/a.js:1:1)`).join('\n');
    expect(sanitizeStack(long)!.length).toBeLessThanOrEqual(2000);
    expect(sanitizeStack('')).toBeNull();
    expect(sanitizeStack('just a sentence')).toBeNull();
    expect(sanitizeStack(undefined)).toBeNull();
  });
});

describe('errorFingerprint', () => {
  const base = { source: 'client' as const, name: 'TypeError', message: 'Cannot read properties of undefined', stack: 'at TripPlanner (/_next/static/chunks/trip.js:12:345)' };

  it('is stable, and blind to line numbers and to numbers in the message', () => {
    const fp = errorFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(errorFingerprint({ ...base })).toBe(fp);
    expect(errorFingerprint({ ...base, stack: 'at TripPlanner (/_next/static/chunks/trip.js:99:1)\nat other (/x.js:1:1)' })).toBe(fp);
    expect(errorFingerprint({ ...base, message: 'Request 12 failed' })).toBe(errorFingerprint({ ...base, message: 'Request 9034 failed' }));
  });

  it('tells apart the source, the name, the message and the top frame', () => {
    const fp = errorFingerprint(base);
    expect(errorFingerprint({ ...base, source: 'server' })).not.toBe(fp);
    expect(errorFingerprint({ ...base, name: 'RangeError' })).not.toBe(fp);
    expect(errorFingerprint({ ...base, message: 'Something else' })).not.toBe(fp);
    expect(errorFingerprint({ ...base, stack: 'at Other (/_next/static/chunks/other.js:12:345)' })).not.toBe(fp);
    expect(errorFingerprint({ ...base, stack: null })).not.toBe(fp);
  });

  it('reads the top frame without its position', () => {
    expect(topFrame('at TripPlanner (/_next/static/chunks/trip.js:12:345)\nat b (/b.js:1:1)')).toBe('at TripPlanner (/_next/static/chunks/trip.js');
    expect(topFrame(null)).toBe('');
  });
});

describe('browserFamily and deviceClass', () => {
  const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    iphoneInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  };

  it('names a coarse browser family', () => {
    expect(browserFamily(UA.iphoneSafari)).toBe('Safari');
    expect(browserFamily(UA.iphoneChrome)).toBe('Chrome');
    expect(browserFamily(UA.iphoneInApp)).toBe('Safari');
    expect(browserFamily(UA.androidChrome)).toBe('Chrome');
    expect(browserFamily(UA.macSafari)).toBe('Safari');
    expect(browserFamily(UA.winChrome)).toBe('Chrome');
    expect(browserFamily(UA.winEdge)).toBe('Edge');
    expect(browserFamily(UA.winFirefox)).toBe('Firefox');
    expect(browserFamily(UA.opera)).toBe('Other');
    expect(browserFamily(UA.samsung)).toBe('Other');
    expect(browserFamily('curl/8.5.0')).toBe('Other');
    expect(browserFamily(null)).toBe('Other');
  });

  it('names a device class', () => {
    expect(deviceClass(UA.iphoneSafari)).toBe('phone');
    expect(deviceClass(UA.androidChrome)).toBe('phone');
    expect(deviceClass(UA.ipad)).toBe('tablet');
    expect(deviceClass(UA.androidTablet)).toBe('tablet');
    expect(deviceClass(UA.macSafari)).toBe('desktop');
    expect(deviceClass(UA.winFirefox)).toBe('desktop');
    expect(deviceClass(null)).toBe('desktop');
  });
});

describe('session ids and events', () => {
  it('accepts 16 to 40 url-safe characters', () => {
    expect(isSessionId('abcdefghijklmnop')).toBe(true);
    expect(isSessionId('a'.repeat(40))).toBe(true);
    expect(isSessionId('a'.repeat(15))).toBe(false);
    expect(isSessionId('a'.repeat(41))).toBe(false);
    expect(isSessionId('abcdefghijklmno!')).toBe(false);
    expect(isSessionId(null)).toBe(false);
  });

  it('cleans one event of each kind and refuses a malformed vital', () => {
    const now = new Date('2026-07-15T18:00:00Z');
    const opts = { now, source: 'client' as const, sessionId: 'abcdefghijklmnop' };
    expect(cleanEvent({ kind: 'view', path: '/i/secret?x=1', name: 'ignored', message: 'ignored' }, opts)).toEqual({ sessionId: 'abcdefghijklmnop', at: now, source: 'client', path: '/i/[token]', kind: 'view' });
    expect(cleanEvent({ kind: 'vital', path: '/', name: 'LCP', value: 1234.5 }, opts)).toMatchObject({ kind: 'vital', name: 'LCP', value: 1234.5 });
    for (const bad of [{ name: 'FID', value: 10 }, { name: 'LCP', value: -1 }, { name: 'LCP', value: Number.NaN }, { name: 'CLS', value: 5000 }, { name: 'LCP' }]) {
      expect(cleanEvent({ kind: 'vital', path: '/', ...bad }, opts)).toBeNull();
    }
    const error = cleanEvent({ kind: 'error', path: '/', name: 'TypeError', message: 'x'.repeat(900), stack: 'TypeError: x\n    at a (/a.js:1:1)' }, opts)!;
    expect(error.message).toHaveLength(300);
    expect(error.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(error.stack).toBe('at a (/a.js:1:1)');
    expect(cleanEvent({ kind: 'error', path: '/' }, opts)).toMatchObject({ message: 'Unknown error', name: null, stack: null });
  });

  it('believes the browser clock only when it is close to the server clock', () => {
    const now = new Date('2026-07-15T18:00:00Z');
    const at = (value: number | string) => (cleanEvent({ kind: 'view', path: '/', at: value }, { now, source: 'client', sessionId: null })!.at as Date).toISOString();
    expect(at(now.getTime() - 30_000)).toBe('2026-07-15T17:59:30.000Z');
    expect(at(now.getTime() - 3_600_000)).toBe(now.toISOString());
    expect(at(now.getTime() + 3_600_000)).toBe(now.toISOString());
    expect(at('not a date')).toBe(now.toISOString());
  });
});

describe('trafficBuckets', () => {
  it('is one bucket per hour, with no gap, covering the whole window', () => {
    const now = new Date('2026-07-15T18:25:00Z');
    const buckets = trafficBuckets(new Date(now.getTime() - 24 * 3_600_000), now, true);
    expect(buckets).toHaveLength(25);
    expect(buckets[0]).toEqual({ key: '2026-07-14T18', at: '2026-07-14T18:00:00.000Z' });
    expect(buckets.at(-1)!.at).toBe('2026-07-15T18:00:00.000Z');
    for (let i = 1; i < buckets.length; i++) expect(Date.parse(buckets[i]!.at) - Date.parse(buckets[i - 1]!.at)).toBe(3_600_000);
  });

  it('is one bucket per America/Chicago day, starting at local midnight', () => {
    const now = new Date('2026-07-15T18:25:00Z');
    const buckets = trafficBuckets(new Date(now.getTime() - 168 * 3_600_000), now, false);
    expect(buckets.map((b) => b.key)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15']);
    // Central Daylight Time is UTC-5.
    expect(buckets[0]!.at).toBe('2026-07-08T05:00:00.000Z');
    // 03:00 UTC is still the evening before in Chicago.
    expect(trafficBuckets(new Date('2026-07-14T03:00:00Z'), new Date('2026-07-15T03:00:00Z'), false).map((b) => b.key)).toEqual(['2026-07-13', '2026-07-14']);
  });

  it('keeps every day across a daylight-saving change', () => {
    // Clocks go back on 2026-11-01: that Chicago day is 25 hours long.
    const buckets = trafficBuckets(new Date('2026-10-30T12:00:00Z'), new Date('2026-11-03T12:00:00Z'), false);
    expect(buckets.map((b) => b.key)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
    expect(buckets.map((b) => b.at)).toEqual(['2026-10-30T05:00:00.000Z', '2026-10-31T05:00:00.000Z', '2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z', '2026-11-03T06:00:00.000Z']);
  });
});

describe('the telemetry switch', () => {
  it('is on unless it is switched off', () => {
    expect(telemetryEnabled({})).toBe(true);
    expect(telemetryEnabled({ TELEMETRY: 'on' })).toBe(true);
    expect(telemetryEnabled({ TELEMETRY: '' })).toBe(true);
    for (const off of ['off', 'OFF', '0', 'false', 'no', ' off ']) expect(telemetryEnabled({ TELEMETRY: off }), off).toBe(false);
  });

  it('is declared in the server environment with its retention', () => {
    expect(parseServerEnv({ NODE_ENV: 'test' })).toMatchObject({ TELEMETRY: true, TELEMETRY_RETENTION_DAYS: 90 });
    expect(parseServerEnv({ NODE_ENV: 'test', TELEMETRY: 'off', TELEMETRY_RETENTION_DAYS: '14' })).toMatchObject({ TELEMETRY: false, TELEMETRY_RETENTION_DAYS: 14 });
    expect(() => parseServerEnv({ NODE_ENV: 'test', TELEMETRY: 'maybe' })).toThrow(/TELEMETRY/);
    expect(() => parseServerEnv({ NODE_ENV: 'test', TELEMETRY_RETENTION_DAYS: '0' })).toThrow(/TELEMETRY_RETENTION_DAYS/);
  });
});

describe('the test server’s telemetry sample', () => {
  const now = new Date('2026-07-15T18:00:00Z');
  const { sessions, events } = buildTelemetryFixtures(now);

  it('is the same every time, clearly synthetic, and inside the last seven days', () => {
    expect(buildTelemetryFixtures(now)).toEqual({ sessions, events });
    expect(sessions).toHaveLength(40);
    expect(sessions.every((s) => s.id.startsWith(TELEMETRY_FIXTURE_SESSION_PREFIX) && isSessionId(s.id))).toBe(true);
    const weekAgo = now.getTime() - 7 * 86_400_000;
    for (const e of events) {
      const at = (e.at as Date).getTime();
      expect(at).toBeGreaterThan(weekAgo);
      expect(at).toBeLessThanOrEqual(now.getTime());
    }
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors.every((e) => e.message!.startsWith(TELEMETRY_FIXTURE_MESSAGE_PREFIX))).toBe(true);
  });

  it('has about 150 page views, some vitals, and three error groups, one of them the server’s', () => {
    const views = events.filter((e) => e.kind === 'view');
    expect(views.length).toBeGreaterThanOrEqual(130);
    expect(views.length).toBeLessThanOrEqual(170);
    expect(sessions.reduce((t, s) => t + (s.pageviews ?? 0), 0)).toBe(views.length);
    expect(new Set(events.filter((e) => e.kind === 'vital').map((e) => e.name))).toEqual(new Set(['LCP', 'CLS', 'INP']));
    const errors = events.filter((e) => e.kind === 'error');
    expect(new Set(errors.map((e) => e.fingerprint)).size).toBe(3);
    expect(new Set(errors.filter((e) => e.source === 'server').map((e) => e.fingerprint)).size).toBe(1);
    expect(errors.filter((e) => e.source === 'server').every((e) => e.sessionId === null)).toBe(true);
    expect(sessions.reduce((t, s) => t + (s.errors ?? 0), 0)).toBe(errors.filter((e) => e.sessionId).length);
    expect(new Set(sessions.map((s) => s.principalKind))).toEqual(new Set(['anonymous', 'guest', 'admin']));
  });
});
