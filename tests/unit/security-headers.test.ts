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
    // And no external script origin, which is the shape most third-party compromise takes.
    expect(prod).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(prod).not.toMatch(/script-src[^;]*https:/);
  });

  it('lets fetches reach this origin and the model hub only, and nothing else off-site', () => {
    // The on-device models download their weights from the Hugging Face Hub; every other
    // connect origin stays blocked. Exactly these hosts, no scheme-wide `https:`.
    const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `));
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co");
    expect(directive(dev, 'connect-src')).toBe("connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co ws: wss:");
    expect(prod).not.toMatch(/connect-src[^;]*https:(?!\/\/)/);
    // Scripts still come from this origin only; the models' wasm is served from /ort/ here.
    expect(directive(prod, 'script-src')).not.toMatch(/huggingface|hf\.co/);
  });

  it('allows WebAssembly compilation without allowing eval in production', () => {
    expect(prod).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
    expect(prod).not.toMatch(/'unsafe-eval'/);
  });

  it('grants the microphone and on-device dictation to this origin only, and nothing else', () => {
    const policy = securityHeaders({ production: true }).find((h) => h.key === 'Permissions-Policy')?.value;
    expect(policy).toBe('camera=(), microphone=(self), geolocation=(), on-device-speech-recognition=(self)');
    // No frame, no other origin, no wildcard.
    expect(policy).not.toMatch(/\*|https?:/);
    expect(securityHeaders({ production: false }).find((h) => h.key === 'Permissions-Policy')?.value).toBe(policy);
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
