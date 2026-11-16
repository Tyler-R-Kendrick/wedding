import { isReplayUrl } from '@/lib/observe/config';
import { MAX_BREADCRUMBS, MAX_ERRORS, MAX_STACK_CHARS, MAX_TEXT_CHARS, type Breadcrumb, type BreadcrumbKind, type CapturedError, type Diagnostics, type ErrorSource } from './types';

/**
 * Scrubbing for anything captured automatically: it runs in the browser before a report is sent and
 * again on the server before one is logged or filed, so neither side trusts the other to have done it.
 *
 * It is deliberately blunt. An email address, a phone number, a six-digit code or a long opaque id
 * in a console message is far more likely to be a guest's than to be the clue that solves the bug.
 */
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g;
const SIX_DIGITS = /(?<![\w.-])\d{6}(?![\w.-])/g;
/** A run of id-like characters with both letters and digits in it: a token, a ULID, a hash. */
const LONG_ID = /[A-Za-z0-9_-]{20,}/g;
const looksOpaque = (s: string) => /\d/.test(s) && /[A-Za-z]/.test(s);

export function scrubText(input: unknown, max = MAX_TEXT_CHARS): string {
  const s = typeof input === 'string' ? input : input == null ? '' : String(input);
  return s
    .slice(0, max * 4)
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
    .replace(SIX_DIGITS, '[code]')
    .replace(LONG_ID, (m) => (looksOpaque(m) ? '[id]' : m))
    // Control characters, and the newline that would let one captured line pose as two log lines.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .slice(0, max);
}

/** A stack keeps its line breaks; everything else about it is scrubbed like any text. */
export function scrubStack(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .split('\n')
    .slice(0, 40)
    .map((line) => scrubText(line.replace(/\?[^\s):]*/g, ''), 400))
    .join('\n')
    .slice(0, MAX_STACK_CHARS);
}

/**
 * An address as a path: no origin, no fragment, the names of its query parameters but never their
 * values (an invitation token, a preview pass and a search all travel there), and any path segment
 * that reads as an id replaced.
 */
export function scrubPath(input: unknown): string {
  if (typeof input !== 'string' || !input) return '';
  let pathname = input;
  let keys: string[] = [];
  try {
    const url = new URL(input, 'https://site.invalid');
    pathname = url.pathname;
    keys = [...new Set(url.searchParams.keys())].slice(0, 8);
  } catch {
    pathname = input.split(/[?#]/)[0] ?? '';
  }
  const path = pathname
    .split('/')
    .map((segment) => (segment.length >= 16 && looksOpaque(segment) ? ':id' : /^\d{4,}$/.test(segment) ? ':n' : segment))
    .join('/')
    .slice(0, 200);
  return keys.length ? `${path}?${keys.map((k) => k.replace(/[^\w.-]/g, '').slice(0, 24)).join('&')}` : path;
}

const KINDS: readonly BreadcrumbKind[] = ['nav', 'click', 'http', 'console', 'error', 'page', 'note'];
const SOURCES: readonly ErrorSource[] = ['error', 'rejection', 'boundary', 'console'];
const time = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const short = (v: unknown, max: number): string => scrubText(v, max);

function cleanCrumb(v: unknown): Breadcrumb | null {
  if (!v || typeof v !== 'object') return null;
  const { t, kind, text } = v as Record<string, unknown>;
  if (!KINDS.includes(kind as BreadcrumbKind)) return null;
  return { t: time(t), kind: kind as BreadcrumbKind, text: short(text, MAX_TEXT_CHARS) };
}

function cleanError(v: unknown): CapturedError | null {
  if (!v || typeof v !== 'object') return null;
  const { t, source, message, stack, digest } = v as Record<string, unknown>;
  const out: CapturedError = { t: time(t), source: SOURCES.includes(source as ErrorSource) ? (source as ErrorSource) : 'error', message: short(message, 500) };
  const cleanStack = scrubStack(stack);
  if (cleanStack) out.stack = cleanStack;
  // A digest is a short number Next made; anything else in that field is not one.
  if (typeof digest === 'string' && /^[A-Za-z0-9_@:-]{1,64}$/.test(digest)) out.digest = digest;
  return out;
}

const ID = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Whatever arrived, as a `Diagnostics` with every field the right type, inside its size, and
 * scrubbed. Returns null for something that is not diagnostics at all. Never throws.
 */
export function cleanDiagnostics(raw: unknown): Diagnostics | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(-max) : []);
  const links = d.links && typeof d.links === 'object' ? (d.links as Record<string, unknown>) : {};
  const linked: NonNullable<Diagnostics['links']> = {
    ...(typeof links.session === 'string' && ID.test(links.session) ? { session: links.session } : {}),
    // A link into the PostHog app only: this ends up as a clickable link in an issue.
    ...(isReplayUrl(links.replay) ? { replay: links.replay } : {}),
  };
  return {
    session: typeof d.session === 'string' && ID.test(d.session) ? d.session : 'unknown',
    build: typeof d.build === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(d.build) ? d.build : 'unknown',
    path: scrubPath(d.path),
    title: short(d.title, 120),
    viewport: typeof d.viewport === 'string' && /^\d{1,5}x\d{1,5}(@[\d.]{1,4})?$/.test(d.viewport) ? d.viewport : '',
    userAgent: typeof d.userAgent === 'string' ? d.userAgent.replace(/[^\x20-\x7e]/g, '').slice(0, 300) : '',
    language: typeof d.language === 'string' && /^[A-Za-z0-9-]{1,20}$/.test(d.language) ? d.language : '',
    timeZone: typeof d.timeZone === 'string' && /^[A-Za-z0-9_+/-]{1,64}$/.test(d.timeZone) ? d.timeZone : '',
    online: d.online !== false,
    startedAt: time(d.startedAt),
    capturedAt: time(d.capturedAt),
    errors: list(d.errors, MAX_ERRORS).map(cleanError).filter((e): e is CapturedError => e !== null),
    breadcrumbs: list(d.breadcrumbs, MAX_BREADCRUMBS).map(cleanCrumb).filter((c): c is Breadcrumb => c !== null),
    ...(Object.keys(linked).length ? { links: linked } : {}),
  };
}
