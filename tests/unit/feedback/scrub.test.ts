import { describe, expect, it } from 'vitest';
import { cleanDiagnostics, scrubPath, scrubStack, scrubText } from '@/lib/diagnostics/scrub';

describe('scrubText', () => {
  it('removes what is most likely a guest’s: addresses, numbers, codes, opaque ids', () => {
    const out = scrubText('sent to jane.doe@example.com and +1 (312) 555-0199, code 482913, token 01HZX4K9M2N8P7Q6R5S4T3V2W1');
    expect(out).toBe('sent to [email] and [phone], code [code], token [id]');
  });

  it('leaves ordinary words, years and short numbers alone', () => {
    expect(scrubText('TypeError: cannot read properties of undefined (reading 390) in 2026')).toBe('TypeError: cannot read properties of undefined (reading 390) in 2026');
    expect(scrubText('a-long-but-entirely-alphabetic-class-name')).toBe('a-long-but-entirely-alphabetic-class-name');
  });

  it('cannot be used to forge a second log line', () => {
    expect(scrubText('first\u0000line\u001bsecond')).not.toMatch(/[\u0000\u001b]/);
  });

  it('caps the length', () => {
    expect(scrubText('x'.repeat(5_000)).length).toBe(300);
  });
});

describe('scrubPath', () => {
  it('keeps the path and the names of query parameters, never their values', () => {
    expect(scrubPath('https://kendrick.wedding/rsvp/step?t=SECRET-TOKEN&preview=RSVP_OPEN#top')).toBe('/rsvp/step?t&preview');
  });

  it('replaces path segments that read as ids', () => {
    expect(scrubPath('/admin/guests/01HZX4K9M2N8P7Q6R5S4T3V2W1/edit')).toBe('/admin/guests/:id/edit');
    expect(scrubPath('/media/123456')).toBe('/media/:n');
  });

  it('answers something for input that is not an address at all', () => {
    expect(scrubPath(undefined)).toBe('');
    expect(scrubPath('')).toBe('');
  });
});

describe('scrubStack', () => {
  it('keeps the lines and drops query strings from frame addresses', () => {
    const stack = 'Error: boom\n    at render (https://kendrick.wedding/_next/static/chunks/app.js?v=abc123def:1:2)';
    expect(scrubStack(stack)).toBe('Error: boom\n    at render (https://kendrick.wedding/_next/static/chunks/app.js:1:2)');
  });
});

describe('cleanDiagnostics', () => {
  const base = {
    session: 'abcdef0123456789',
    build: 'a1b2c3d',
    path: '/rsvp?t=secret',
    title: 'RSVP | Sara + Tyler',
    viewport: '390x844@3',
    userAgent: 'Mozilla/5.0',
    language: 'en-US',
    timeZone: 'America/Chicago',
    online: true,
    startedAt: 1_700_000_000_000,
    capturedAt: 1_700_000_060_000,
    errors: [{ t: 1, source: 'boundary', message: 'failed for jane@example.com', digest: '123456789', stack: 'Error\n at x' }],
    breadcrumbs: [{ t: 1, kind: 'click', text: 'button.btn' }, { t: 2, kind: 'nonsense', text: 'dropped' }],
  };

  it('returns null for anything that is not diagnostics', () => {
    expect(cleanDiagnostics(null)).toBeNull();
    expect(cleanDiagnostics('a string')).toBeNull();
  });

  it('scrubs again on the server, whatever the browser claims to have done', () => {
    const d = cleanDiagnostics(base)!;
    expect(d.path).toBe('/rsvp?t');
    expect(d.errors[0]!.message).toBe('failed for [email]');
    expect(d.errors[0]!.digest).toBe('123456789');
    expect(d.breadcrumbs).toHaveLength(1);
  });

  it('bounds every list and coerces every wrong type', () => {
    const d = cleanDiagnostics({ ...base, session: '<script>', viewport: 'huge', errors: Array.from({ length: 50 }, () => base.errors[0]), breadcrumbs: Array.from({ length: 500 }, () => base.breadcrumbs[0]), online: 'yes' })!;
    expect(d.session).toBe('unknown');
    expect(d.viewport).toBe('');
    expect(d.errors).toHaveLength(10);
    expect(d.breadcrumbs).toHaveLength(50);
  });

  it('keeps a replay link only when it points into the PostHog app', () => {
    const ok = cleanDiagnostics({ ...base, links: { session: '0195c1a2-aaaa-7bbb-8ccc-1234567890ab', replay: 'https://us.posthog.com/project/1/replay/0195c1a2?t=30' } })!;
    expect(ok.links).toEqual({ session: '0195c1a2-aaaa-7bbb-8ccc-1234567890ab', replay: 'https://us.posthog.com/project/1/replay/0195c1a2?t=30' });
    const bad = cleanDiagnostics({ ...base, links: { replay: 'https://evil.example/replay/1', session: 'x y' } })!;
    expect(bad.links).toBeUndefined();
    expect(cleanDiagnostics({ ...base, links: { replay: 'javascript:alert(1)//us.posthog.com/replay/' } })!.links).toBeUndefined();
  });
});
