import { createHmac, timingSafeEqual } from 'node:crypto';
import { STAGE_IDS } from './stage-hosting';

/**
 * Who may see the design pipeline's stages when the app serves them (src/lib/stage-hosting.ts).
 *
 * The stages redraw the real pages, the guest and admin ones included, with their headings and
 * labels left readable: the venue's name on the venue page, the date on the dashboard. Nothing
 * about the wedding is public, so a deployed stage is for the people who may see those pages
 * anyway: a signed-in admin. There is no separate password and nothing to configure.
 *
 *   off Vercel   open: a local checkout and CI serve them as before
 *   on Vercel    a signed-in admin, remembered on the stage addresses for twelve hours
 *
 * A stage is a static export on a host that shares no cookie with the site, so the site's session
 * cannot guard it directly. Instead a stage request with no pass is sent to `/admin/stages` on the
 * site, which checks the admin session (sign-in first if there is none) and sends the browser back
 * to the stage with a one-minute signed ticket; the proxy swaps the ticket for a pass cookie. Both
 * are HMACs under the site's own `BETTER_AUTH_SECRET`, bound to the addresses they open.
 *
 * Pure (the clock and the secret are arguments), so the proxy, the route and the tests read the
 * same rule.
 */
export type StageAccess = 'open' | 'admin' | 'closed';

export function stageAccess(env: { VERCEL?: string | undefined; BETTER_AUTH_SECRET?: string | undefined }): StageAccess {
  if (!env.VERCEL) return 'open';
  // Production refuses to start without the secret (src/lib/env.ts); closed is for a broken preview.
  return env.BETTER_AUTH_SECRET ? 'admin' : 'closed';
}

export const STAGE_PASS_COOKIE = 'stage-pass';
/** Where a stage address takes its ticket. Not a page of any stage: their paths never start `__`. */
export const STAGE_ENTER_PATH = '/__stage-pass';
/** Where the site hands tickets out (src/app/(admin)/admin/stages/route.ts). */
export const STAGE_DOOR_PATH = '/admin/stages';
const TICKET_SECONDS = 60;
export const PASS_SECONDS = 12 * 60 * 60;

type Purpose = 'ticket' | 'pass';
const STAGES = STAGE_IDS.join('|');
const HOST = new RegExp(`^(?:(${STAGES})\\.)?dev\\.(.+)$`);
const PATH = new RegExp(`^/(${STAGES}|stages)(/.*)?$`);
/** A path on a stage: letters, digits and `- _ . /` only, so it survives a query string unquoted. */
const SAFE_PATH = /^\/[A-Za-z0-9_\-./]*$/;
const WHERE = new RegExp(`^(${STAGES}|hub)(/[A-Za-z0-9_\\-./]*)?$`);

const sign = (secret: string, purpose: Purpose, scope: string, expires: number): string =>
  createHmac('sha256', secret).update(`stage-${purpose}|${scope}|${expires}`).digest('base64url');

/** `<expiry in seconds>.<signature>`, good for one purpose on one set of addresses. */
export function mintStageToken(secret: string, purpose: Purpose, scope: string, now: number = Date.now()): string {
  const expires = Math.floor(now / 1000) + (purpose === 'ticket' ? TICKET_SECONDS : PASS_SECONDS);
  return `${expires}.${sign(secret, purpose, scope, expires)}`;
}

export function stageTokenValid(secret: string, purpose: Purpose, scope: string, token: string | null | undefined, now: number = Date.now()): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!secret || !match) return false;
  const expires = Number(match[1]);
  if (expires * 1000 <= now) return false;
  const given = Buffer.from(match[2]!);
  const wanted = Buffer.from(sign(secret, purpose, scope, expires));
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export interface StageAddress {
  /** A stage on its own subdomain, or by path on the site's own host (previews). */
  via: 'host' | 'path';
  /** What a pass is good for: `dev.<site host>` for the subdomains, the host itself for paths. */
  scope: string;
  /** The host that has the sign-in. */
  siteHost: string;
  /** `wireframe/guests/travel`, `hub`: the stage and the page on it, as the door reads them. */
  where: string;
}

/** Reads a stage address. Null when the request is not for a stage. */
export function stageAddress(host: string, pathname: string): StageAddress | null {
  const onHost = HOST.exec(host);
  if (onHost) {
    const path = SAFE_PATH.test(pathname) && pathname !== STAGE_ENTER_PATH ? pathname.replace(/\/+$/, '') : '';
    return { via: 'host', scope: `dev.${onHost[2]}`, siteHost: onHost[2]!, where: `${onHost[1] ?? 'hub'}${path}` };
  }
  const onPath = PATH.exec(pathname);
  if (!onPath && pathname !== STAGE_ENTER_PATH) return null;
  const rest = onPath?.[2] && SAFE_PATH.test(onPath[2]) ? onPath[2].replace(/\/+$/, '') : '';
  return { via: 'path', scope: host, siteHost: host, where: !onPath || onPath[1] === 'stages' ? 'hub' : `${onPath[1]}${rest}` };
}

/** The address the door sends an admin back to, or null for anything it did not expect. */
export function stageReturn(via: string | null, where: string | null, siteHost: string): { origin: string; scope: string; path: string } | null {
  const match = WHERE.exec(where ?? '');
  if (!match || (where ?? '').includes('..') || (via !== 'host' && via !== 'path')) return null;
  const [, stage, rest = ''] = match;
  if (via === 'host') return { origin: `${stage === 'hub' ? '' : `${stage}.`}dev.${siteHost}`, scope: `dev.${siteHost}`, path: stage === 'hub' ? '/' : rest || '/' };
  return { origin: siteHost, scope: siteHost, path: stage === 'hub' ? '/stages' : `/${stage}${rest}` };
}

export type StageDecision =
  | { kind: 'serve' }
  | { kind: 'not-found' }
  | { kind: 'redirect'; location: string; pass?: { value: string; domain?: string; maxAge: number } };

export interface StageRequest {
  host: string;
  protocol: 'http' | 'https';
  pathname: string;
  /** `t` and `to` of the request, when it is the ticket address. */
  ticket: string | null;
  to: string | null;
  /** The pass cookie, if the browser sent one. */
  pass: string | undefined;
  /** A page, as opposed to a script, a font or a fetch: only a page is worth sending to sign-in. */
  document: boolean;
}

/** What the proxy does with a request for a deployed stage. */
export function decideStage(request: StageRequest, env: { VERCEL?: string | undefined; BETTER_AUTH_SECRET?: string | undefined }, now: number = Date.now()): StageDecision {
  const access = stageAccess(env);
  if (access === 'open') return { kind: 'serve' };
  const address = stageAddress(request.host, request.pathname);
  const secret = env.BETTER_AUTH_SECRET;
  if (access === 'closed' || !secret || !address) return { kind: 'not-found' };

  if (request.pathname === STAGE_ENTER_PATH) {
    if (!stageTokenValid(secret, 'ticket', address.scope, request.ticket, now)) return { kind: 'not-found' };
    const to = request.to && SAFE_PATH.test(request.to) && !request.to.startsWith('//') && !request.to.includes('..') ? request.to : '/';
    const domain = address.via === 'host' ? address.scope.replace(/:\d+$/, '') : undefined;
    return { kind: 'redirect', location: to, pass: { value: mintStageToken(secret, 'pass', address.scope, now), ...(domain ? { domain } : {}), maxAge: PASS_SECONDS } };
  }
  if (stageTokenValid(secret, 'pass', address.scope, request.pass, now)) return { kind: 'serve' };
  if (!request.document) return { kind: 'not-found' };
  return { kind: 'redirect', location: `${request.protocol}://${address.siteHost}${STAGE_DOOR_PATH}?via=${address.via}&to=${encodeURIComponent(address.where)}` };
}
