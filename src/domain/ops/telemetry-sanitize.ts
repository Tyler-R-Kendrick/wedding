import { createHash } from 'node:crypto';
import type { VisitDevice, VisitEventSource } from '@/db/schema';

/**
 * What a visit event is reduced to before it is stored. Everything here is pure: the ingestion
 * route, the server-error hook and the fixture seed all pass their input through these, so the
 * `visit_events` table can only ever hold what these let through.
 */

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,40}$/;
export const MAX_PATH_CHARS = 200;
export const MAX_MESSAGE_CHARS = 300;
export const MAX_NAME_CHARS = 80;
export const MAX_STACK_FRAMES = 8;
export const MAX_STACK_CHARS = 2000;
const MAX_FRAME_CHARS = 300;

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/**
 * Routes whose path IS the secret: an invitation token, an invite token, a guest's sign-in pass.
 * The value after each prefix is replaced by the route's own placeholder, so the page still counts
 * as a page and the token is never written down. Keep in step with `src/app/(auth)`.
 */
const SECRET_ROUTES: readonly { prefix: string; placeholder: string; rest: boolean }[] = [
  { prefix: '/i/', placeholder: '[token]', rest: false },
  { prefix: '/invite/', placeholder: '[token]', rest: false },
  { prefix: '/s/', placeholder: '[slug]', rest: false },
  // Signed storage keys in local development; everything after the prefix names a private file.
  { prefix: '/api/dev/storage/', placeholder: '[key]', rest: true },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A segment that is an opaque value rather than a word: a UUID, a ULID, a base64url token, a long
 * hex or digit run. Slugs (`starved-rock-state-park`) are lower-case words joined by hyphens and
 * are kept.
 */
function isOpaqueSegment(segment: string): boolean {
  if (UUID.test(segment)) return true;
  if (/^\d{6,}$/.test(segment)) return true;
  if (segment.length < 20 || !/^[A-Za-z0-9_-]+$/.test(segment) || !/\d/.test(segment)) return false;
  return /[A-Z]/.test(segment) || !segment.includes('-');
}

/**
 * A pathname and nothing else: no origin, no query string, no hash. Secret-bearing segments are
 * collapsed (`/i/<token>` → `/i/[token]`), opaque ids become `[id]`, anything with an `@` becomes
 * `[redacted]`, and the prerendered tree's `/t/<theme>` prefix is dropped so `/t/x/our-story` and
 * `/our-story` are one page.
 */
export function sanitizePath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  let path = raw.trim().slice(0, 2048);
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path);
  if (scheme) path = path.slice(scheme[0].length);
  path = path.split(/[?#]/, 1)[0] ?? '';
  // Control characters and whitespace have no place in a path; an encoded one stays encoded.
  path = path.replace(/[\u0000- \u007f]+/g, '');
  if (!path.startsWith('/')) return '/';
  path = path.replace(/\/{2,}/g, '/');
  const themed = /^\/t\/[^/]+(\/.*)?$/.exec(path);
  if (themed) path = themed[1] || '/';
  for (const route of SECRET_ROUTES) {
    if (!path.startsWith(route.prefix) || path.length === route.prefix.length) continue;
    const after = path.slice(route.prefix.length);
    const tail = route.rest ? '' : after.includes('/') ? after.slice(after.indexOf('/')) : '';
    path = `${route.prefix}${route.placeholder}${tail}`;
    break;
  }
  const segments = path.split('/').map((segment, index) => {
    if (index === 0 || segment === '' || /^\[[a-z]+\]$/.test(segment)) return segment;
    if (segment.includes('@') || /%40/i.test(segment)) return '[redacted]';
    return isOpaqueSegment(segment) ? '[id]' : segment;
  });
  path = segments.join('/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path.slice(0, MAX_PATH_CHARS) || '/';
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_IN_TEXT = /\b(?:https?|wss?|file|webpack-internal|blob):\/\/[^\s)'"<>]+/gi;
/** Twenty or more token characters with a digit among them: a session token, a hash, a key. */
const TOKEN = /(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{6,}/g;

/** `https://host/i/abc?x=1:10:4` → `/i/[token]:10:4`. The position suffix of a stack frame survives. */
function reduceUrl(url: string): string {
  const position = /(:\d+){1,2}$/.exec(url)?.[0] ?? '';
  const body = position ? url.slice(0, -position.length) : url;
  return `${sanitizePath(body)}${position}`;
}

function redact(text: string): string {
  return text.replace(URL_IN_TEXT, reduceUrl).replace(EMAIL, '[email]').replace(TOKEN, '[redacted]').replace(PHONE, '[number]').replace(LONG_DIGITS, '[number]');
}

/** An error message fit to keep: one line, URLs reduced to paths, emails, tokens and long numbers redacted, at most 300 characters. */
export function sanitizeMessage(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const oneLine = raw.slice(0, 4000).replace(/\s+/g, ' ').trim();
  return redact(oneLine).slice(0, MAX_MESSAGE_CHARS);
}

/** An error or vital name: a short identifier (`TypeError`, `ChunkLoadError`, `LCP`), or null. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, MAX_NAME_CHARS);
  return /^[A-Za-z][A-Za-z0-9_.$ -]*$/.test(name) ? name : null;
}

const FRAME = /^(?:at\s|[^\s@]*@)|:\d+(?::\d+)?\)?$/;

/**
 * The top frames of a stack: at most 8 lines and 2000 characters. Each frame's URL is reduced to a
 * path (so no host, query string or token), `root` (the server's working directory) is dropped,
 * and emails are redacted. Lines that are not frames, such as the leading `TypeError: …` that
 * repeats the message, are left out.
 */
export function sanitizeStack(raw: unknown, opts: { root?: string } = {}): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const frames: string[] = [];
  for (const line of raw.slice(0, 20_000).split('\n')) {
    let frame = line.trim();
    if (!frame || !FRAME.test(frame)) continue;
    if (opts.root) frame = frame.split(opts.root).join('');
    frame = frame.replace(URL_IN_TEXT, reduceUrl).replace(/\?[^\s:)]*/g, '').replace(EMAIL, '[email]').slice(0, MAX_FRAME_CHARS);
    frames.push(frame);
    if (frames.length >= MAX_STACK_FRAMES) break;
  }
  if (frames.length === 0) return null;
  let out = frames.join('\n');
  while (out.length > MAX_STACK_CHARS && frames.length > 1) {
    frames.pop();
    out = frames.join('\n');
  }
  return out.slice(0, MAX_STACK_CHARS);
}

/** The first frame with its line and column removed, so one fault keeps one fingerprint as code around it moves. */
export function topFrame(stack: string | null | undefined): string {
  const first = stack?.split('\n', 1)[0]?.trim() ?? '';
  return first.replace(/(:\d+)+\)?$/, '').replace(/\)$/, '');
}

/**
 * Groups one fault: the source, the error's name, the message with its numbers flattened, and the
 * top frame. Takes values that are already sanitised, so two reports of the same fault that differ
 * only in a redacted detail hash alike.
 */
export function errorFingerprint(e: { source: VisitEventSource; name: string | null; message: string; stack: string | null }): string {
  const message = e.message.toLowerCase().replace(/\d+/g, '0').replace(/\s+/g, ' ').trim();
  const frame = topFrame(e.stack).replace(/\d+/g, '0');
  return createHash('sha256').update([e.source, e.name ?? '', message, frame].join('\n')).digest('hex').slice(0, 16);
}

export const BROWSER_FAMILIES = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Other'] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

/**
 * A coarse browser family from a User-Agent header. The header itself is never stored. Order
 * matters: Edge and Opera both say `Chrome`, and every Chromium says `Safari`.
 */
export function browserFamily(userAgent: string | null | undefined): BrowserFamily {
  const ua = userAgent ?? '';
  if (!ua) return 'Other';
  if (/\b(?:Edg|EdgA|EdgiOS|Edge)\//.test(ua)) return 'Edge';
  if (/\b(?:OPR|Opera|SamsungBrowser|UCBrowser|YaBrowser|DuckDuckGo)\//.test(ua)) return 'Other';
  if (/\b(?:Firefox|FxiOS)\//.test(ua)) return 'Firefox';
  if (/\b(?:Chrome|CriOS|Chromium)\//.test(ua)) return 'Chrome';
  // In-app browsers on iOS are WebKit without the `Safari/` token; they render as Safari does.
  if (/\bSafari\//.test(ua) || /\b(?:iPhone|iPad|iPod)\b.*AppleWebKit/.test(ua)) return 'Safari';
  return 'Other';
}

/** Phone, tablet or desktop from a User-Agent header. An iPad that asks for the desktop site says it is a Mac and is counted as one. */
export function deviceClass(userAgent: string | null | undefined): VisitDevice {
  const ua = userAgent ?? '';
  if (/\b(?:iPad|Tablet|PlayBook|Silk|Kindle)\b/i.test(ua)) return 'tablet';
  if (/\bAndroid\b/i.test(ua)) return /\bMobile\b/i.test(ua) ? 'phone' : 'tablet';
  if (/\b(?:iPhone|iPod|Mobi|Mobile|Windows Phone)\b/i.test(ua)) return 'phone';
  return 'desktop';
}
