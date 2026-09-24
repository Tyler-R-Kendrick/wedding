import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { matchHas, prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { isStageHost, isStagePath, stageRewrites } from '@/lib/stage-hosting';

/**
 * Replays the beforeFiles rewrites the way Next's router does (resolve-routes.js): in order, each
 * matching rule applied to the previous one's result, `has` checked against the request's Host.
 * This is the behaviour that turned `/icon.svg` into `…/icon.svg/…icon.svg.html` once; the probe
 * (scripts/stages/probe.mjs) checks the same thing against a running app.
 */
function resolve(pathname: string, host: string, production = false): string {
  let path = pathname;
  const req = { headers: { host } } as unknown as IncomingMessage;
  for (const rule of stageRewrites({ production })) {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(path);
    if (!params) continue;
    const hasParams = matchHas(req, {}, rule.has as never, undefined);
    if (!hasParams) continue;
    path = prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params: { ...params, ...hasParams }, query: {} }).parsedDestination.pathname!;
  }
  return path;
}

describe('stage hosting rewrites', () => {
  it('serve a stage at its own subdomain: pages, files, and its own /_next', () => {
    expect(resolve('/', 'sitemap.dev.kendrick.wedding')).toBe('/_stages/_hosts/sitemap/index.html');
    expect(resolve('/rsvp', 'sitemap.dev.kendrick.wedding')).toBe('/_stages/_hosts/sitemap/rsvp.html');
    expect(resolve('/our-adventures/example', 'wireframe.dev.kendrick.wedding')).toBe('/_stages/_hosts/wireframe/our-adventures/example.html');
    expect(resolve('/icon.svg', 'skeleton.dev.kendrick.wedding')).toBe('/_stages/_hosts/skeleton/icon.svg');
    expect(resolve('/_next/static/chunks/a.js', 'placeholder.dev.localhost:3000')).toBe('/_stages/_hosts/placeholder/_next/static/chunks/a.js');
  });

  it('serve the hub at dev.<domain>/, and nothing else there: never the wedding app under a second name', () => {
    expect(resolve('/', 'dev.kendrick.wedding')).toBe('/_stages/_hub/index.html');
    for (const path of ['/rsvp', '/admin', '/api/auth/session', '/our-story']) expect(resolve(path, 'dev.kendrick.wedding', true), path).toBe('/_stages-not-served');
    // The app's own assets stay reachable there, so its 404 page is styled.
    expect(resolve('/_next/static/chunks/a.js', 'dev.kendrick.wedding')).toBe('/_next/static/chunks/a.js');
  });

  it('never serve the assembled files directly, on any host', () => {
    for (const host of ['kendrick.wedding', 'wedding-git-x.vercel.app', 'dev.kendrick.wedding', 'localhost:3000']) {
      expect(resolve('/_stages/_hub/index.html', host), host).toBe('/_stages-not-served');
      expect(resolve('/_stages/_hosts/sitemap/index.html', host, true), host).toBe('/_stages-not-served');
    }
    expect(resolve('/_stages/_hosts/sitemap/index.html', 'sitemap.dev.kendrick.wedding')).toBe('/_stages/_hosts/sitemap/_stages-not-served.html');
  });

  it('leave the wedding site itself alone', () => {
    for (const host of ['kendrick.wedding', 'www.kendrick.wedding', 'wedding-git-x.vercel.app']) {
      expect(resolve('/', host, true)).toBe('/');
      expect(resolve('/rsvp', host, true)).toBe('/rsvp');
      expect(resolve('/sitemap', host, true)).toBe('/sitemap');
      expect(resolve('/_next/static/chunks/a.js', host, true)).toBe('/_next/static/chunks/a.js');
    }
  });

  it('outside production, also serve every stage and the hub by path, on any host', () => {
    expect(resolve('/stages', 'wedding-git-x.vercel.app')).toBe('/_stages/_hub/index.html');
    expect(resolve('/sitemap', 'wedding-git-x.vercel.app')).toBe('/_stages/sitemap/index.html');
    expect(resolve('/sitemap/rsvp', 'wedding-git-x.vercel.app')).toBe('/_stages/sitemap/rsvp.html');
    expect(resolve('/placeholder/_next/static/a.js', 'localhost:3000')).toBe('/_stages/placeholder/_next/static/a.js');
    expect(resolve('/', 'localhost:3000')).toBe('/');
    expect(resolve('/stages', 'kendrick.wedding', true)).toBe('/stages');
  });

  it('never rewrite a path twice', () => {
    // Each rule sees the one before it's result: a file rewrite must not then match the page rule.
    expect(resolve('/icon.svg', 'sitemap.dev.kendrick.wedding')).toBe('/_stages/_hosts/sitemap/icon.svg');
    expect(resolve('/sitemap/icon.svg', 'localhost:3000')).toBe('/_stages/sitemap/icon.svg');
    expect(resolve('/sitemap/rsvp', 'localhost:3000')).toBe('/_stages/sitemap/rsvp.html');
  });

  it('tell the proxy which requests are the stages', () => {
    expect(isStageHost('sitemap.dev.kendrick.wedding')).toBe(true);
    expect(isStageHost('dev.kendrick.wedding')).toBe(true);
    expect(isStageHost('dev.localhost:3000')).toBe(true);
    expect(isStageHost('kendrick.wedding')).toBe(false);
    expect(isStageHost('devon.example')).toBe(false);
    const preview = { production: false };
    expect(isStagePath('/sitemap/rsvp', preview)).toBe(true);
    expect(isStagePath('/stages', preview)).toBe(true);
    expect(isStagePath('/sitemaps', preview)).toBe(false);
    expect(isStagePath('/rsvp', preview)).toBe(false);
    // Production serves no stage by path, so the proxy treats /sitemap like any other request.
    expect(isStagePath('/sitemap/rsvp', { production: true })).toBe(false);
  });
});
