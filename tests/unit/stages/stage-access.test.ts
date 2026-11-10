import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageAccess, stageAuthorized, stageDenial } from '@/lib/stage-access';
import { STAGE_IDS } from '@/lib/stage-hosting';

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;

describe('who may see a deployed design stage', () => {
  it('is open off Vercel, closed on it without a password, and asks for one when it is set', () => {
    expect(stageAccess({})).toBe('open');
    expect(stageAccess({ STAGES_PASSWORD: 'x' })).toBe('open');
    expect(stageAccess({ VERCEL: '1' })).toBe('closed');
    expect(stageAccess({ VERCEL: '1', STAGES_PASSWORD: '' })).toBe('closed');
    expect(stageAccess({ VERCEL: '1', STAGES_PASSWORD: 'peony-and-brass' })).toBe('password');
  });

  it('accepts the password with any user name, and nothing else', () => {
    const password = 'peony-and-brass';
    expect(stageAuthorized(basic('sara', password), password)).toBe(true);
    expect(stageAuthorized(basic('', password), password)).toBe(true);
    expect(stageAuthorized(basic('sara', 'péony — brass'), 'péony — brass')).toBe(true);
    for (const bad of [null, undefined, '', 'Basic', 'Basic !!!', `Bearer ${password}`, basic('sara', 'peony-and-bras'), basic('sara', `${password}x`), basic(password, ''), `Basic ${Buffer.from(password).toString('base64')}`]) {
      expect(stageAuthorized(bad, password), String(bad)).toBe(false);
    }
    expect(stageAuthorized(basic('sara', ''), '')).toBe(false);
  });

  it('answers 404 when closed, 401 with the browser prompt when the password is missing or wrong, and serves otherwise', () => {
    expect(stageDenial('open', null, undefined)).toBeNull();
    expect(stageDenial('closed', basic('a', 'b'), undefined)).toMatchObject({ status: 404 });
    const asked = stageDenial('password', null, 'pw-123456');
    expect(asked).toMatchObject({ status: 401 });
    expect(asked!.headers['WWW-Authenticate']).toMatch(/^Basic realm=/);
    expect(asked!.headers['Cache-Control']).toBe('no-store');
    expect(stageDenial('password', basic('a', 'wrong'), 'pw-123456')).toMatchObject({ status: 401 });
    expect(stageDenial('password', basic('a', 'pw-123456'), 'pw-123456')).toBeNull();
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
