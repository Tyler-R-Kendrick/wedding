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
 * Only these addresses serve them. `/_stages/…` itself is never served directly, so the drafts are
 * not reachable on kendrick.wedding at all, and `dev.<domain>` is the hub and nothing else: every
 * other path there is a 404, never the wedding app under a second name.
 *
 * Imported by next.config.ts (the rewrites) and src/proxy.ts (which steps aside on these hosts).
 */
export const STAGE_IDS = ['sitemap', 'wireframe', 'skeleton', 'placeholder'] as const;
export type StageId = (typeof STAGE_IDS)[number];

const STAGES = STAGE_IDS.join('|');
/** Next's `has.value` for a stage subdomain; `stage` is a named group the destinations use. */
const STAGE_HOST_VALUE = `(?<stage>${STAGES})\\.dev\\..+`;
const HUB_HOST_VALUE = 'dev\\..+';

/** `sitemap.dev.kendrick.wedding`, `wireframe.dev.kendrick.localhost:3000`, and the hub's `dev.…`. */
export function isStageHost(host: string | null | undefined): boolean {
  return !!host && new RegExp(`^(?:(?:${STAGES})\\.)?dev\\.`).test(host);
}

/** `/sitemap/rsvp`, `/stages`: a stage by path, which only a non-production build serves. */
export function isStagePath(pathname: string, { production }: { production: boolean }): boolean {
  return !production && new RegExp(`^/(?:${STAGES}|stages)(?:/|$)`).test(pathname);
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
/** Where a request that must not be served is sent: no file, no route, so the app's 404. */
const NOWHERE = '/_stages-not-served';

export function stageRewrites({ production }: { production: boolean }): Rewrite[] {
  const onStageHost = [{ type: 'host' as const, value: STAGE_HOST_VALUE }];
  const onHubHost = [{ type: 'host' as const, value: HUB_HOST_VALUE }];
  const byHost: Rewrite[] = [
    // First, so it sees only what was asked for, never a path a later rule produced.
    { source: '/_stages/:path*', destination: NOWHERE },
    { source: '/', has: onStageHost, destination: '/_stages/_hosts/:stage/index.html' },
    { source: `/${FILE}`, has: onStageHost, destination: '/_stages/_hosts/:stage/:file' },
    { source: `/${PAGE}`, has: onStageHost, destination: '/_stages/_hosts/:stage/:page.html' },
    { source: '/', has: onHubHost, destination: '/_stages/_hub/index.html' },
    // The hub host is the hub alone. `/_next/` stays the app's, so its 404 page has its styles.
    { source: '/:path((?!_next/|_stages).+)', has: onHubHost, destination: NOWHERE },
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
