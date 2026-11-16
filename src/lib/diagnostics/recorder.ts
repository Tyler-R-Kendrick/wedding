import { scrubPath, scrubStack, scrubText } from './scrub';
import { MAX_BREADCRUMBS, MAX_ERRORS, PULSE_PATH, type Breadcrumb, type BreadcrumbKind, type CapturedError, type Diagnostics, type ErrorSource } from './types';

/**
 * The browser's flight recorder: the last fifty things that happened on this tab and the last ten
 * errors, kept in memory. It runs for every visitor (src/instrumentation-client.ts installs it
 * before React starts) and it sends nothing on its own account. Two things read it:
 *
 *  - an uncaught error, which is posted to `/api/pulse` with the steps that led to it, so a
 *    failure a guest never mentions is still on record with what they were doing;
 *  - the couple's problem report (src/components/feedback), which attaches the same snapshot.
 *
 * It records the shape of what happened, never its content: which control, not its label; which
 * address, not its query; that a request failed and its request id, not what it carried. No
 * keystroke, no field value and no page text is ever read.
 *
 * Plain DOM, no React, no imports beyond its own types: it has to work on a page whose components
 * have just failed.
 */
const SESSION_KEY = 'wedding:trace';
/** At most this many error reports per page load: a render loop must not become a request loop. */
const MAX_REPORTS_PER_PAGE = 5;

interface State {
  session: string;
  startedAt: number;
  breadcrumbs: Breadcrumb[];
  errors: CapturedError[];
  reported: Set<string>;
  links: NonNullable<Diagnostics['links']>;
}

/**
 * What the hosted session tracker installs once it has loaded (src/lib/observe/posthog-client.ts).
 * A window hook rather than an import: the recorder must not pull that SDK into the first view, and
 * must work exactly the same when it never arrives.
 */
export interface Observer {
  /** Refreshes `links` with this session's ids. */
  link(): void;
  /** Sends an error the tracker's own autocapture cannot see (one an error boundary caught). */
  report(error: unknown, properties?: Record<string, unknown>): void;
}

type Host = typeof globalThis & { __weddingRecorder?: State; __weddingObserve?: Observer };

const observer = (): Observer | undefined => (globalThis as Host).__weddingObserve;

function newSession(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readSession(): string {
  try {
    const kept = sessionStorage.getItem(SESSION_KEY);
    if (kept && /^[0-9a-f]{16}$/.test(kept)) return kept;
    const made = newSession();
    sessionStorage.setItem(SESSION_KEY, made);
    return made;
  } catch {
    // Storage is blocked (private mode, a strict setting): the id lasts for this page.
    return newSession();
  }
}

function state(): State {
  const host = globalThis as Host;
  return (host.__weddingRecorder ??= { session: readSession(), startedAt: Date.now(), breadcrumbs: [], errors: [], reported: new Set(), links: {} });
}

export function addBreadcrumb(kind: BreadcrumbKind, text: string): void {
  try {
    const crumbs = state().breadcrumbs;
    crumbs.push({ t: Date.now(), kind, text: scrubText(text) });
    if (crumbs.length > MAX_BREADCRUMBS) crumbs.splice(0, crumbs.length - MAX_BREADCRUMBS);
  } catch {
    // The recorder never throws into the page it is watching.
  }
}

/** Ids the hosted tracker gave this visit, so a report can link to its replay and trace. */
export function linkDiagnostics(links: NonNullable<Diagnostics['links']>): void {
  Object.assign(state().links, links);
}

/** Which control, in the page's own vocabulary: `button.btn.btn--primary[name=answer]`. Never its text. */
export function describeElement(target: EventTarget | null): string {
  if (!(target instanceof Element)) return '';
  const el = target.closest('a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"]') ?? target;
  const tag = el.tagName.toLowerCase();
  const id = el.id && el.id.length < 40 && !/\d{4,}/.test(el.id) ? `#${el.id}` : '';
  const classes = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('') : '';
  const name = el.getAttribute('name');
  const type = tag === 'input' || tag === 'button' ? el.getAttribute('type') : null;
  const href = tag === 'a' ? scrubPath(el.getAttribute('href') ?? '') : '';
  return `${tag}${id}${classes}${type ? `[type=${type}]` : ''}${name ? `[name=${name.slice(0, 40)}]` : ''}${href ? ` -> ${href}` : ''}`;
}

function messageOf(value: unknown): { message: string; stack?: string; digest?: string } {
  if (value instanceof Error) {
    const digest = (value as Error & { digest?: unknown }).digest;
    return { message: `${value.name}: ${value.message}`, ...(value.stack ? { stack: value.stack } : {}), ...(typeof digest === 'string' ? { digest } : {}) };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value)?.slice(0, 500) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/**
 * Records an error and, the first time this page sees it, reports it. `source: 'console'` is
 * recorded but not reported: the site's own code logs handled failures there.
 */
export function captureError(value: unknown, source: ErrorSource, extra: { digest?: string } = {}): void {
  try {
    const s = state();
    const read = messageOf(value);
    const digest = extra.digest ?? read.digest;
    const error: CapturedError = { t: Date.now(), source, message: scrubText(read.message, 500), ...(read.stack ? { stack: scrubStack(read.stack) } : {}), ...(digest ? { digest } : {}) };
    s.errors.push(error);
    if (s.errors.length > MAX_ERRORS) s.errors.splice(0, s.errors.length - MAX_ERRORS);
    addBreadcrumb('error', `${source}: ${error.message}`);
    if (source === 'console') return;
    if (source === 'boundary') observer()?.report(value, { source, ...(digest ? { digest } : {}) });
    const key = `${error.message}|${digest ?? ''}`;
    if (s.reported.has(key) || s.reported.size >= MAX_REPORTS_PER_PAGE) return;
    s.reported.add(key);
    send({ v: 1, type: 'error', diagnostics: snapshot() });
  } catch {
    // See addBreadcrumb.
  }
}

export function snapshot(): Diagnostics {
  const s = state();
  try {
    observer()?.link();
  } catch {
    // The snapshot is worth having without the links.
  }
  return {
    session: s.session,
    build: process.env.NEXT_PUBLIC_BUILD_SHA || 'dev',
    path: scrubPath(location.pathname + location.search),
    title: scrubText(document.title, 120),
    viewport: `${window.innerWidth}x${window.innerHeight}@${Math.round((window.devicePixelRatio || 1) * 10) / 10}`,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    online: navigator.onLine,
    startedAt: s.startedAt,
    capturedAt: Date.now(),
    errors: [...s.errors],
    breadcrumbs: [...s.breadcrumbs],
    ...(Object.keys(s.links).length ? { links: { ...s.links } } : {}),
  };
}

/** `sendBeacon` survives the page closing; `fetch` with keepalive is the fallback. Never awaited. */
function send(body: unknown): void {
  try {
    const json = JSON.stringify(body);
    const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(PULSE_PATH, new Blob([json], { type: 'application/json' }));
    if (!sent) void fetch(PULSE_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true, credentials: 'omit' }).catch(() => undefined);
  } catch {
    // Nowhere left to say so.
  }
}

/** Requests the recorder itself makes, or that a hosted tracker's tunnel makes: never recorded. */
const OWN_PATHS = [PULSE_PATH, '/api/observe'];

function watchFetch(): void {
  const original = window.fetch;
  if (typeof original !== 'function') return;
  window.fetch = function recordedFetch(this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let method = 'GET';
    let path = '';
    let own = true;
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
      own = url.origin !== location.origin || OWN_PATHS.some((p) => url.pathname.startsWith(p));
      path = scrubPath(url.pathname + url.search);
    } catch {
      own = true;
    }
    const started = performance.now();
    const call = original.call(this, input, init) as Promise<Response>;
    if (own) return call;
    call.then(
      (res) => {
        const ms = Math.round(performance.now() - started);
        const requestId = res.status >= 400 ? res.headers.get('x-request-id') : null;
        addBreadcrumb('http', `${method} ${path} ${res.status} ${ms}ms${requestId ? ` request ${requestId}` : ''}`);
      },
      (e: unknown) => addBreadcrumb('http', `${method} ${path} failed: ${e instanceof Error ? e.name : 'error'}`),
    );
    return call;
  };
}

function watchConsole(): void {
  for (const level of ['error', 'warn'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      try {
        const first = args.find((a) => a instanceof Error) ?? args[0];
        if (level === 'error') captureError(first, 'console');
        else addBreadcrumb('console', `warn: ${messageOf(first).message}`);
      } catch {
        // Fall through to the real console.
      }
      original.apply(console, args);
    };
  }
}

/** Idempotent: a hot reload or a second import installs nothing twice. */
export function installRecorder(): void {
  const host = globalThis as Host & { __weddingRecorderInstalled?: boolean };
  if (typeof window === 'undefined' || host.__weddingRecorderInstalled) return;
  host.__weddingRecorderInstalled = true;
  state();
  addBreadcrumb('page', `loaded ${scrubPath(location.pathname + location.search)}`);
  window.addEventListener('error', (e) => {
    // A script or image that failed to load arrives here too, with no `error` on it.
    if (e.error !== undefined && e.error !== null) captureError(e.error, 'error');
    else if (e.message) captureError(e.message, 'error');
    else if (e.target instanceof Element) addBreadcrumb('error', `failed to load ${e.target.tagName.toLowerCase()} ${scrubPath(e.target.getAttribute('src') ?? e.target.getAttribute('href') ?? '')}`);
  }, true);
  window.addEventListener('unhandledrejection', (e) => captureError(e.reason, 'rejection'));
  window.addEventListener('click', (e) => addBreadcrumb('click', describeElement(e.target)), { capture: true, passive: true });
  window.addEventListener('submit', (e) => addBreadcrumb('click', `submit ${describeElement(e.target)}`), { capture: true, passive: true });
  window.addEventListener('popstate', () => addBreadcrumb('nav', `back/forward to ${scrubPath(location.pathname + location.search)}`));
  window.addEventListener('offline', () => addBreadcrumb('page', 'went offline'));
  window.addEventListener('online', () => addBreadcrumb('page', 'back online'));
  document.addEventListener('visibilitychange', () => addBreadcrumb('page', document.visibilityState === 'hidden' ? 'tab hidden' : 'tab shown'));
  watchFetch();
  watchConsole();
}
