import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(basePath?: string) {
  vi.resetModules();
  if (basePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
  else process.env.NEXT_PUBLIC_BASE_PATH = basePath;
  return import('../lib/pipeline');
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_STAGE_URL_REAL;
  delete process.env.NEXT_PUBLIC_STAGES_DEV_ORIGIN;
});

describe('stage addressing', () => {
  it('on a stage subdomain, links to sibling subdomains and to the real site without dev.', async () => {
    const { stageHref, hubHref } = await load();
    const here = { protocol: 'https:', host: 'sitemap.dev.kendrick.wedding' };
    expect(stageHref('wireframe', '/rsvp', here)).toBe('https://wireframe.dev.kendrick.wedding/rsvp');
    expect(stageHref('sitemap', '/rsvp', here)).toBe('https://sitemap.dev.kendrick.wedding/rsvp');
    expect(stageHref('real', '/rsvp', here)).toBe('https://kendrick.wedding/rsvp');
    expect(hubHref(here)).toBe('https://dev.kendrick.wedding/');
  });

  it('locally, on the app dev server, keeps the port for every stage and for the real app', async () => {
    const { stageHref, hubHref } = await load();
    const here = { protocol: 'http:', host: 'skeleton.dev.localhost:3000' };
    expect(stageHref('placeholder', '/', here)).toBe('http://placeholder.dev.localhost:3000/');
    expect(stageHref('real', '/gifts', here)).toBe('http://localhost:3000/gifts');
    expect(hubHref(here)).toBe('http://dev.localhost:3000/');
  });

  it('under a path prefix (PR previews), links to sibling prefixes and the real app on the same host', async () => {
    const { stageHref, hubHref, withBase } = await load('/skeleton');
    const here = { protocol: 'https:', host: 'wedding-git-x.vercel.app' };
    expect(stageHref('sitemap', '/rsvp', here)).toBe('/sitemap/rsvp');
    expect(stageHref('real', '/rsvp', here)).toBe('/rsvp');
    expect(hubHref(here)).toBe('/stages');
    expect(withBase('/sitemap.json')).toBe('/skeleton/sitemap.json');
  });

  it('on dev ports, links port to port and has no hub', async () => {
    const { stageHref, hubHref } = await load();
    const here = { protocol: 'http:', host: 'localhost:3103' };
    expect(stageHref('wireframe', '/rsvp', here)).toBe('http://localhost:3102/rsvp');
    expect(hubHref(here)).toBeNull();
  });

  it('an explicit URL wins, for a real site that is not the dev host minus dev.', async () => {
    process.env.NEXT_PUBLIC_STAGE_URL_REAL = 'https://saraandtyler.example/';
    const { stageHref } = await load();
    expect(stageHref('real', '/rsvp', { protocol: 'https:', host: 'sitemap.dev.other.example' })).toBe('https://saraandtyler.example/rsvp');
  });

  it('a subdomain build links to the subdomains before the browser has an address (static HTML, no JS yet)', async () => {
    process.env.NEXT_PUBLIC_STAGES_DEV_ORIGIN = 'https://dev.kendrick.wedding';
    const { stageHref, hubHref } = await load();
    expect(stageHref('wireframe', '/rsvp')).toBe('https://wireframe.dev.kendrick.wedding/rsvp');
    expect(stageHref('real', '/rsvp')).toBe('https://kendrick.wedding/rsvp');
    expect(hubHref()).toBe('https://dev.kendrick.wedding/');
    // Once the browser knows better (a different dev domain), its address wins.
    expect(stageHref('wireframe', '/rsvp', { protocol: 'http:', host: 'sitemap.dev.localhost:3000' })).toBe('http://wireframe.dev.localhost:3000/rsvp');
  });

  it('does not mistake an ordinary subdomain for a stage host', async () => {
    const { devHostOf } = await load();
    expect(devHostOf('sitemap.example.com')).toBeNull();
    expect(devHostOf('www.example.com')).toBeNull();
    expect(devHostOf('dev.example.com')).toBe('dev.example.com');
  });
});
