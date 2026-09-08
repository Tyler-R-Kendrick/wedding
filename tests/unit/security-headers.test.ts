import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '@/lib/security-headers';

/**
 * The browser's verdict on this policy lives in tests/e2e/security-headers.spec.ts, which loads
 * real pages and fails on any `securitypolicyviolation` the browser reports. This file only pins
 * the shape — the directives that would be quiet to lose, and the dev/production difference.
 */
describe('security headers', () => {
  const prod = contentSecurityPolicy({ production: true });
  const dev = contentSecurityPolicy({ production: false });

  it('carries the directives that do the work even with unsafe-inline in script-src', () => {
    // These four are what a CSP buys here, and none of them is weakened by 'unsafe-inline':
    // no plugins, no injected <base> repointing every relative URL, no framing, no off-site POST.
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("form-action 'self'");
    // And no external script or connect origin, which is the shape most third-party compromise takes.
    expect(prod).toContain("script-src 'self' 'unsafe-inline'");
    expect(prod).toContain("connect-src 'self'");
    expect(prod).not.toMatch(/script-src[^;]*https:/);
    expect(prod).not.toMatch(/connect-src[^;]*https:/);
  });

  it('relaxes only what a dev server needs, and only there', () => {
    // React's dev build evals to rebuild server stacks; `next dev` opens an HMR websocket.
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('ws:');
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain('ws:');
    // upgrade-insecure-requests would rewrite a local http dev server's own requests.
    expect(prod).toContain('upgrade-insecure-requests');
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  it('sends HSTS in production only, without preload', () => {
    const names = (production: boolean) => securityHeaders({ production }).map((h) => h.key);
    expect(names(true)).toContain('Strict-Transport-Security');
    expect(names(false)).not.toContain('Strict-Transport-Security');
    const hsts = securityHeaders({ production: true }).find((h) => h.key === 'Strict-Transport-Security');
    expect(hsts?.value).toBe('max-age=63072000; includeSubDomains');
    // The preload list is effectively one-way; committing the couple's domain is not ours to do.
    expect(hsts?.value).not.toContain('preload');
  });

  it('keeps the headers the earlier levels already set', () => {
    const keys = securityHeaders({ production: true }).map((h) => h.key);
    expect(keys).toEqual([
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Content-Security-Policy',
      'Strict-Transport-Security',
    ]);
  });
});
