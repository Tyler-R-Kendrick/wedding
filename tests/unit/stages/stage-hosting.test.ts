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

  it('serve the hub at dev.<domain>/ only', () => {
    expect(resolve('/', 'dev.kendrick.wedding')).toBe('/_stages/_hub/index.html');
    expect(resolve('/rsvp', 'dev.kendrick.wedding')).toBe('/rsvp');
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
    expect(resolve('/_stages/_hosts/sitemap/icon.svg', 'sitemap.dev.kendrick.wedding')).toBe('/_stages/_hosts/sitemap/icon.svg');
    expect(resolve('/_stages/sitemap/rsvp.html', 'localhost:3000')).toBe('/_stages/sitemap/rsvp.html');
  });

  it('tell the proxy which requests are the stages', () => {
    expect(isStageHost('sitemap.dev.kendrick.wedding')).toBe(true);
    expect(isStageHost('dev.kendrick.wedding')).toBe(true);
    expect(isStageHost('dev.localhost:3000')).toBe(true);
    expect(isStageHost('kendrick.wedding')).toBe(false);
    expect(isStageHost('devon.example')).toBe(false);
    expect(isStagePath('/sitemap/rsvp')).toBe(true);
    expect(isStagePath('/stages')).toBe(true);
    expect(isStagePath('/sitemaps')).toBe(false);
    expect(isStagePath('/rsvp')).toBe(false);
  });
});
