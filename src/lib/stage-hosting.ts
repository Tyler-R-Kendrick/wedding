/**
 * The wedding app also hosts the design pipeline's stages (stages/README.md), so every stage is
 * online wherever the site is:
 *
 *   sitemap.dev.kendrick.wedding/rsvp       a stage on its own subdomain        (production)
 *   dev.kendrick.wedding/                   the hub and its sign-off board      (production)
 *   <preview host>/sitemap/rsvp             a stage by path                     (previews, local)
 *   <preview host>/stages                   the hub by path                     (previews, local)
 *
 * The stages are static exports assembled into public/_stages/ before `next build`
 * (scripts/stages/assemble.mjs): `_hosts/<stage>/` built at a host root, `<stage>/` built under
 * `/<stage>`, and `_hub/`. These rewrites run before the app's own routes and files, so on a
 * stage host even `/_next/…` means that stage's bundle, not the app's. Path addressing is left
 * out of production builds: the stages are not part of kendrick.wedding itself.
 *
 * Imported by next.config.ts (the rewrites) and src/proxy.ts (which steps aside on these hosts).
 */
export const STAGE_IDS = ['sitemap', 'wireframe', 'skeleton', 'placeholder'] as const;
export type StageId = (typeof STAGE_IDS)[number];

const STAGES = STAGE_IDS.join('|');
/** Next's `has.value` for a stage subdomain; `stage` is a named group the destinations use. */
const STAGE_HOST_VALUE = `(?<stage>${STAGES})\\.dev\\..+`;
const HUB_HOST_VALUE = 'dev\\..+';

/** `sitemap.dev.kendrick.wedding`, `wireframe.dev.localhost:3000`, and the hub's `dev.…`. */
export function isStageHost(host: string | null | undefined): boolean {
  return !!host && new RegExp(`^(?:(?:${STAGES})\\.)?dev\\.`).test(host);
}

export function isStagePath(pathname: string): boolean {
  return new RegExp(`^/(?:${STAGES}|stages)(?:/|$)`).test(pathname);
}

interface Rewrite {
  source: string;
  destination: string;
  has?: { type: 'host'; value: string }[];
}

/**
 * Next applies every matching beforeFiles rewrite in turn, each to the previous one's result, so
 * a rule must not match a path an earlier rule produced: both patterns skip `/_stages/…`.
 * Without that, `/icon.svg` became `/_stages/_hosts/sitemap/icon.svg`, then
 * `/_stages/_hosts/sitemap/_stages/_hosts/sitemap/icon.svg.html`.
 */
/** A file request: its last segment has an extension (`/_next/static/a.js`, `/rsvp.txt`). */
const FILE = ':file((?!_stages/).+\\.[A-Za-z0-9]+)';
/** A page request: anything else. */
const PAGE = ':page((?!_stages/).+)';

export function stageRewrites({ production }: { production: boolean }): Rewrite[] {
  const onStageHost = [{ type: 'host' as const, value: STAGE_HOST_VALUE }];
  const onHubHost = [{ type: 'host' as const, value: HUB_HOST_VALUE }];
  const byHost: Rewrite[] = [
    { source: '/', has: onStageHost, destination: '/_stages/_hosts/:stage/index.html' },
    { source: `/${FILE}`, has: onStageHost, destination: '/_stages/_hosts/:stage/:file' },
    { source: `/${PAGE}`, has: onStageHost, destination: '/_stages/_hosts/:stage/:page.html' },
    { source: '/', has: onHubHost, destination: '/_stages/_hub/index.html' },
  ];
  if (production) return byHost;
  const stage = `:stage(${STAGES})`;
  return [
    ...byHost,
    { source: '/stages', destination: '/_stages/_hub/index.html' },
    { source: `/${stage}`, destination: '/_stages/:stage/index.html' },
    { source: `/${stage}/${FILE}`, destination: '/_stages/:stage/:file' },
    { source: `/${stage}/${PAGE}`, destination: '/_stages/:stage/:page.html' },
  ];
}

/** The stages are working drafts: never indexed, wherever they are served. */
export function stageHeaders(): { source: string; has?: { type: 'host'; value: string }[]; headers: { key: string; value: string }[] }[] {
  const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
  return [
    { source: '/:path*', has: [{ type: 'host', value: `(?:(?:${STAGES})\\.)?dev\\..+` }], headers: noindex },
    { source: `/:stage(${STAGES}|stages|_stages)/:path*`, headers: noindex },
    { source: `/:stage(${STAGES}|stages)`, headers: noindex },
  ];
}
