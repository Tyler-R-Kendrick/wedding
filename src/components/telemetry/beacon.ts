/**
 * The browser half of first-party telemetry (docs/ops/admin-guide.md, "Telemetry"). No dependency,
 * no cookie, nothing persistent: the session id lives in `sessionStorage`, so a session is one
 * tab's visit and ends with it. Everything is feature-detected and wrapped; this file must never
 * throw into a page, and it does nothing until an effect calls it.
 *
 * What it sends to `POST /api/telemetry`:
 *   - `view`   the pathname (never the query string or hash) on load and on each client navigation;
 *   - `vital`  LCP, CLS and INP, once, when the page is first hidden;
 *   - `error`  uncaught errors and unhandled rejections, each distinct message once per session,
 *              at most ten per page load.
 * A browser that asks not to be tracked (Do Not Track or Global Privacy Control) sends no views
 * and no vitals, and its errors carry no session id.
 */

export const TELEMETRY_ENDPOINT = '/api/telemetry';
const SESSION_KEY = 'wedding.visit';
const SEEN_ERRORS_KEY = 'wedding.visit.errors';
const FLUSH_AFTER_MS = 2000;
const MAX_BATCH = 20;
/** The route caps a body at 16 KB and an error's stack is the only long field. */
const MAX_ERRORS_PER_BATCH = 5;
const MAX_ERRORS_PER_LOAD = 10;
const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_CHARS = 1200;
/**
 * A design stage's host (`wireframe.dev.…`) or the hub's (`dev.…`). The same rule as `isStageHost`
 * in src/lib/stage-hosting.ts, written out so this file imports nothing; tests/ui/telemetry.test.tsx
 * holds the two together.
 */
export const STAGE_HOST = /^(?:(?:sitemap|wireframe|skeleton|placeholder)\.)?dev\./;
/** Browsers report these for layout work that resolved on its own; nobody saw anything. */
const NOISE = /^ResizeObserver loop/;

type BeaconEvent = { kind: 'view' | 'error' | 'vital'; path: string; at: number; name?: string; value?: number; message?: string; stack?: string };

interface State {
  /** Aborting it removes every listener this state installed. */
  stop: AbortController | null;
  queue: BeaconEvent[];
  timer: ReturnType<typeof setTimeout> | null;
  sessionId: string | null;
  untracked: boolean;
  lastView: string | null;
  loadPath: string;
  errors: number;
  seen: Set<string>;
  vitalsSent: boolean;
  lcp: number | null;
  cls: number;
  clsSeen: boolean;
  interactions: Map<number, number>;
}

type TelemetryWindow = Window & { __weddingTelemetry?: State | null };

const pathname = (): string => {
  try {
    return window.location.pathname || '/';
  } catch {
    return '/';
  }
};

/** Sixteen random bytes as base64url: 22 characters of `[A-Za-z0-9_-]`. Null where the browser has no CSPRNG. */
function randomId(): string | null {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return null;
  }
}

/** This tab's session id: read from `sessionStorage`, made on first use. With storage blocked it lasts one page load. */
function sessionId(): string | null {
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,40}$/.test(stored)) return stored;
  } catch {
    // Storage is blocked (private mode, a sandboxed frame): fall through to an id that lasts this load.
  }
  const id = randomId();
  try {
    if (id) window.sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // As above.
  }
  return id;
}

function asksNotToBeTracked(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
    return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
  } catch {
    return false;
  }
}

function seenErrors(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SEEN_ERRORS_KEY);
    return new Set(raw ? raw.split(',').slice(0, 50) : []);
  } catch {
    return new Set();
  }
}

/** A short, stable key for a message, so the list of ones already sent stays small and holds no text. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function send(state: State): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  while (state.queue.length > 0) {
    const events: BeaconEvent[] = [];
    let errors = 0;
    while (state.queue.length > 0 && events.length < MAX_BATCH) {
      if (state.queue[0]!.kind === 'error' && ++errors > MAX_ERRORS_PER_BATCH) break;
      events.push(state.queue.shift()!);
    }
    const body = JSON.stringify({ ...(state.sessionId && !state.untracked ? { sessionId: state.sessionId } : {}), events });
    let queued = false;
    try {
      // `application/json` is what the route's same-origin check asks for; a Blob is how a beacon carries a type.
      if (typeof navigator.sendBeacon === 'function') queued = navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([body], { type: 'application/json' }));
    } catch {
      queued = false;
    }
    if (queued) continue;
    try {
      if (typeof fetch !== 'function') return;
      void fetch(TELEMETRY_ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
    } catch {
      return;
    }
  }
}

function enqueue(state: State, event: BeaconEvent): void {
  if (state.queue.length >= MAX_BATCH * 3) return;
  state.queue.push(event);
  if (!state.timer) state.timer = setTimeout(() => send(state), FLUSH_AFTER_MS);
}

function reportError(state: State, error: unknown, fallback?: string): void {
  if (state.errors >= MAX_ERRORS_PER_LOAD) return;
  const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null | undefined;
  const message = String((e && typeof e === 'object' ? e.message : error) ?? fallback ?? 'Unknown error').slice(0, MAX_MESSAGE_CHARS);
  if (!message || NOISE.test(message)) return;
  const name = e && typeof e === 'object' && typeof e.name === 'string' ? e.name.slice(0, 80) : undefined;
  const key = hash(`${name ?? ''}:${message}`);
  if (state.seen.has(key)) return;
  state.seen.add(key);
  try {
    window.sessionStorage.setItem(SEEN_ERRORS_KEY, [...state.seen].slice(-50).join(','));
  } catch {
    // Without storage the same message can be sent once per page load, not once per session.
  }
  state.errors += 1;
  const stack = e && typeof e === 'object' && typeof e.stack === 'string' ? e.stack.slice(0, MAX_STACK_CHARS) : undefined;
  enqueue(state, { kind: 'error', path: pathname(), at: Date.now(), ...(name ? { name } : {}), message, ...(stack ? { stack } : {}) });
}

function observe(type: string, options: Record<string, unknown>, onEntries: (entries: PerformanceEntry[]) => void): void {
  try {
    if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    new PerformanceObserver((list) => {
      try {
        onEntries(list.getEntries());
      } catch {
        // A browser quirk in one entry must not stop the page.
      }
    }).observe({ type, buffered: true, ...options });
  } catch {
    // Unsupported entry type or options: that vital is simply not reported.
  }
}

function watchVitals(state: State): void {
  observe('largest-contentful-paint', {}, (entries) => {
    const last = entries.at(-1);
    if (last) state.lcp = last.startTime;
  });
  // CLS is the worst burst of shifts: bursts end after a second of quiet or five seconds in all.
  let burst = 0;
  let burstStart = 0;
  let burstEnd = 0;
  observe('layout-shift', {}, (entries) => {
    for (const entry of entries as (PerformanceEntry & { value?: number; hadRecentInput?: boolean })[]) {
      if (entry.hadRecentInput || typeof entry.value !== 'number') continue;
      if (burst > 0 && entry.startTime - burstEnd < 1000 && entry.startTime - burstStart < 5000) burst += entry.value;
      else {
        burst = entry.value;
        burstStart = entry.startTime;
      }
      burstEnd = entry.startTime;
      state.clsSeen = true;
      if (burst > state.cls) state.cls = burst;
    }
  });
  observe('event', { durationThreshold: 40 }, (entries) => {
    for (const entry of entries as (PerformanceEntry & { interactionId?: number })[]) {
      if (!entry.interactionId) continue;
      const longest = Math.max(state.interactions.get(entry.interactionId) ?? 0, entry.duration);
      state.interactions.set(entry.interactionId, longest);
      // Only the slowest few can ever be the answer.
      if (state.interactions.size > 60) {
        const fastest = [...state.interactions.entries()].sort((a, b) => a[1] - b[1])[0];
        if (fastest) state.interactions.delete(fastest[0]);
      }
    }
  });
}

function reportVitals(state: State): void {
  if (state.vitalsSent || state.untracked || !state.sessionId) return;
  state.vitalsSent = true;
  const at = Date.now();
  const vital = (name: string, value: number) => state.queue.push({ kind: 'vital', path: state.loadPath, at, name, value: Math.round(value * 1000) / 1000 });
  if (state.lcp !== null) vital('LCP', state.lcp);
  // A layout that never shifted is a score of zero, and worth saying; a browser that cannot measure it says nothing.
  if (state.clsSeen || (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('layout-shift'))) vital('CLS', state.cls);
  if (state.interactions.size > 0) {
    // INP is the slowest interaction, forgiving one outlier for every fifty.
    const slowest = [...state.interactions.values()].sort((a, b) => b - a);
    const count = (performance as Performance & { interactionCount?: number }).interactionCount ?? slowest.length;
    vital('INP', slowest[Math.min(slowest.length - 1, Math.floor(count / 50))]!);
  }
}

function start(): State | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || typeof document === 'undefined') return null;
  if (typeof navigator.sendBeacon !== 'function' && typeof fetch !== 'function') return null;
  // The design stages are static drafts of the pages, not visits to the site.
  if (STAGE_HOST.test(window.location.host.toLowerCase())) return null;
  // Where AbortController is missing the listeners simply stay for the life of the page, which is how long they are wanted.
  const stop = typeof AbortController === 'function' ? new AbortController() : null;
  const listen = stop ? { signal: stop.signal } : undefined;
  const state: State = {
    stop,
    queue: [],
    timer: null,
    sessionId: sessionId(),
    untracked: asksNotToBeTracked(),
    lastView: null,
    loadPath: pathname(),
    errors: 0,
    seen: seenErrors(),
    vitalsSent: false,
    lcp: null,
    cls: 0,
    clsSeen: false,
    interactions: new Map(),
  };
  window.addEventListener(
    'error',
    (event) => {
      try {
        reportError(state, event.error ?? event.message, event.message);
      } catch {
        // Never an error about an error.
      }
    },
    listen,
  );
  window.addEventListener(
    'unhandledrejection',
    (event) => {
      try {
        reportError(state, event.reason, 'Unhandled promise rejection');
      } catch {
        // As above.
      }
    },
    listen,
  );
  const leaving = () => {
    try {
      reportVitals(state);
      send(state);
    } catch {
      // The page is going away; there is nobody to tell.
    }
  };
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') leaving();
    },
    listen,
  );
  window.addEventListener('pagehide', leaving, listen);
  if (!state.untracked && state.sessionId) watchVitals(state);
  return state;
}

/**
 * Records a view of the page now showing. Called from an effect on mount and on every client
 * navigation; the first call also installs the error and vitals listeners. A repeat for the page
 * already recorded (React's double effect in development) is ignored.
 */
export function trackPageView(): void {
  try {
    const w = window as TelemetryWindow;
    if (w.__weddingTelemetry === undefined) w.__weddingTelemetry = start();
    const state = w.__weddingTelemetry;
    if (!state || state.untracked || !state.sessionId) return;
    const path = pathname();
    if (path === state.lastView) return;
    state.lastView = path;
    // The console is not the site: an administrator's own clicks around /admin would otherwise
    // lead "busiest pages" and pad the visit count. Errors there are still recorded (the listeners
    // above are installed either way), because a broken admin screen is worth knowing about.
    if (path === '/admin' || path.startsWith('/admin/')) return;
    enqueue(state, { kind: 'view', path, at: Date.now() });
  } catch {
    // Telemetry never breaks a page.
  }
}

/** Tests: forget this page load, as a full navigation would (listeners, queue and timer; `sessionStorage` is the caller's). */
export function resetTelemetry(): void {
  try {
    const w = window as TelemetryWindow;
    const state = w.__weddingTelemetry;
    if (state?.timer) clearTimeout(state.timer);
    state?.stop?.abort();
    delete w.__weddingTelemetry;
  } catch {
    // Nothing to forget.
  }
}
