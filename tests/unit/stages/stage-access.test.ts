import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideStage, mintStageToken, PASS_SECONDS, stageAccess, stageAddress, stageReturn, stageTokenValid, type StageRequest } from '@/lib/stage-access';
import { STAGE_IDS } from '@/lib/stage-hosting';
import { isSafeReturnPath } from '@/domain/identity/routes';

const secret = 'unit-test-secret-not-a-real-one';
const deployed = { VERCEL: '1', BETTER_AUTH_SECRET: secret };
const now = Date.UTC(2030, 0, 1);
const page = (over: Partial<StageRequest>): StageRequest => ({ host: 'wireframe.dev.example.test', protocol: 'https', pathname: '/guests/travel', ticket: null, to: null, pass: undefined, document: true, ...over });

describe('who may see a deployed design stage', () => {
  it('is open off Vercel and for a signed-in admin on it, with nothing to configure', () => {
    expect(stageAccess({})).toBe('open');
    expect(stageAccess(deployed)).toBe('admin');
    expect(stageAccess({ VERCEL: '1' })).toBe('closed');
    expect(decideStage(page({}), {}, now)).toEqual({ kind: 'serve' });
    expect(decideStage(page({}), { VERCEL: '1' }, now)).toEqual({ kind: 'not-found' });
  });

  it('sends a page with no pass to the site door, and answers 404 for anything else', () => {
    expect(decideStage(page({}), deployed, now)).toEqual({ kind: 'redirect', location: 'https://example.test/admin/stages?via=host&to=wireframe%2Fguests%2Ftravel' });
    expect(decideStage(page({ host: 'dev.example.test', pathname: '/' }), deployed, now)).toEqual({ kind: 'redirect', location: 'https://example.test/admin/stages?via=host&to=hub' });
    expect(decideStage(page({ host: 'preview.example.test', pathname: '/skeleton/rsvp' }), deployed, now)).toEqual({ kind: 'redirect', location: 'https://preview.example.test/admin/stages?via=path&to=skeleton%2Frsvp' });
    expect(decideStage(page({ document: false, pathname: '/_next/static/a.js' }), deployed, now)).toEqual({ kind: 'not-found' });
  });

  it('the door address survives the sign-in page, which only returns to addresses it knows', () => {
    const { location } = decideStage(page({}), deployed, now) as { location: string };
    const door = new URL(location);
    expect(isSafeReturnPath(`${door.pathname}${door.search}`)).toBe(true);
  });

  it('swaps a ticket for a pass that opens every stage address, and only those', () => {
    const back = stageReturn('host', 'wireframe/guests/travel', 'example.test')!;
    expect(back).toEqual({ origin: 'wireframe.dev.example.test', scope: 'dev.example.test', path: '/guests/travel' });
    const ticket = mintStageToken(secret, 'ticket', back.scope, now);
    const entered = decideStage(page({ pathname: '/__stage-pass', ticket, to: back.path }), deployed, now);
    expect(entered).toMatchObject({ kind: 'redirect', location: '/guests/travel', pass: { domain: 'dev.example.test', maxAge: PASS_SECONDS } });
    const pass = (entered as { pass: { value: string } }).pass.value;

    for (const host of ['wireframe.dev.example.test', 'sitemap.dev.example.test', 'dev.example.test']) {
      expect(decideStage(page({ host, pass, document: false }), deployed, now), host).toEqual({ kind: 'serve' });
    }
    // Another site's stages, the ticket used as a pass, a pass used as a ticket, and an expired pass.
    expect(decideStage(page({ host: 'wireframe.dev.other.test', pass, document: false }), deployed, now)).toEqual({ kind: 'not-found' });
    expect(decideStage(page({ pass: ticket, document: false }), deployed, now)).toEqual({ kind: 'not-found' });
    expect(decideStage(page({ pathname: '/__stage-pass', ticket: pass }), deployed, now)).toEqual({ kind: 'not-found' });
    expect(decideStage(page({ pass, document: false }), deployed, now + PASS_SECONDS * 1000)).toEqual({ kind: 'not-found' });
    expect(decideStage(page({ pathname: '/__stage-pass', ticket, to: back.path }), deployed, now + 61_000)).toEqual({ kind: 'not-found' });
  });

  it('refuses a token that was altered or signed with another secret', () => {
    const pass = mintStageToken(secret, 'pass', 'dev.example.test', now);
    expect(stageTokenValid(secret, 'pass', 'dev.example.test', pass, now)).toBe(true);
    const [expires, signature] = pass.split('.');
    for (const bad of [null, '', 'x', `${Number(expires) + 1}.${signature}`, `${expires}.${signature!.slice(0, -1)}A`, mintStageToken('another-secret', 'pass', 'dev.example.test', now)]) {
      expect(stageTokenValid(secret, 'pass', 'dev.example.test', bad, now), String(bad)).toBe(false);
    }
    expect(stageTokenValid('', 'pass', 'dev.example.test', pass, now)).toBe(false);
  });

  it('after the ticket, goes only to a path on the stage itself', () => {
    const ticket = mintStageToken(secret, 'ticket', 'dev.example.test', now);
    for (const to of ['//evil.test', 'https://evil.test', '/a/../b', '/a b', null]) {
      expect(decideStage(page({ pathname: '/__stage-pass', ticket, to }), deployed, now), String(to)).toMatchObject({ location: '/' });
    }
  });

  it('the door builds the way back itself and ignores anything that is not a stage', () => {
    expect(stageReturn('host', 'hub', 'example.test')).toEqual({ origin: 'dev.example.test', scope: 'dev.example.test', path: '/' });
    expect(stageReturn('path', 'hub', 'preview.example.test')).toEqual({ origin: 'preview.example.test', scope: 'preview.example.test', path: '/stages' });
    expect(stageReturn('path', 'skeleton/rsvp', 'preview.example.test')).toEqual({ origin: 'preview.example.test', scope: 'preview.example.test', path: '/skeleton/rsvp' });
    for (const [via, to] of [['host', 'admin'], ['host', 'wireframe/../x'], ['host', 'evil.test/x'], ['elsewhere', 'hub'], ['host', null], [null, 'hub'], ['host', 'wireframe/a?b']] as const) {
      expect(stageReturn(via, to, 'example.test'), `${via} ${to}`).toBeNull();
    }
  });

  it('reads every stage address there is', () => {
    for (const id of STAGE_IDS) {
      expect(stageAddress(`${id}.dev.example.test`, '/')).toMatchObject({ via: 'host', scope: 'dev.example.test', where: id });
      expect(stageAddress('preview.example.test', `/${id}/rsvp`)).toMatchObject({ via: 'path', scope: 'preview.example.test', where: `${id}/rsvp` });
    }
    expect(stageAddress('example.test', '/guests')).toBeNull();
  });
});

describe('the proxy sees every request for a stage', () => {
  // The matcher has to be literal for Next to read it at build time, so it cannot import STAGE_IDS.
  const proxy = readFileSync('src/proxy.ts', 'utf8');

  it('matches whole stage hosts and stage paths, files included, for every stage there is', () => {
    const ids = STAGE_IDS.join('|');
    expect(proxy).toContain(`{ source: '/:path*', has: [{ type: 'host', value: '(?:(?:${ids})\\\\.)?dev\\\\..+' }] }`);
    expect(proxy).toContain(`'/:stage(${ids}|stages)/:path*'`);
    expect(proxy).toContain(`'/:stage(${ids}|stages)'`);
  });
});
