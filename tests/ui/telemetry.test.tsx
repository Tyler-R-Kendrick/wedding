import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTelemetry, STAGE_HOST, TELEMETRY_ENDPOINT } from '@/components/telemetry/beacon';
import { Telemetry } from '@/components/telemetry/Telemetry';
import { SESSION_ID_PATTERN } from '@/domain/ops/telemetry-sanitize';
import { isStageHost, STAGE_IDS } from '@/lib/stage-hosting';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

type Batch = { sessionId?: string; events: { kind: string; path: string; at: number; name?: string; value?: number; message?: string; stack?: string }[] };
type TelemetryWindow = Window & { __weddingTelemetry?: unknown };

const blobs: Blob[] = [];
const sendBeacon = vi.fn((_url: string, body: Blob) => {
  blobs.push(body);
  return true;
});
const batches = async (): Promise<Batch[]> => Promise.all(blobs.map(async (b) => JSON.parse(await b.text()) as Batch));

function visit(path: string) {
  pathname = path;
  window.history.replaceState({}, '', `${path}?secret=abc#frag`);
}

/** Leaving the page (or hiding the tab) is what flushes the queue. */
const leave = () => window.dispatchEvent(new Event('pagehide'));

beforeEach(() => {
  blobs.length = 0;
  sendBeacon.mockClear();
  resetTelemetry();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  visit('/');
});
afterEach(() => {
  resetTelemetry();
  vi.useRealTimers();
});

describe('<Telemetry />', () => {
  it('renders nothing', () => {
    const { container } = render(<Telemetry />);
    expect(container.innerHTML).toBe('');
  });

  it('reports a view of the pathname on load and on each client navigation, as an application/json beacon', async () => {
    const { rerender } = render(<Telemetry />);
    visit('/our-story');
    rerender(<Telemetry />);
    // The same page again (React's double effect) is not a second view.
    rerender(<Telemetry />);
    leave();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]![0]).toBe(TELEMETRY_ENDPOINT);
    // What `assertSameOriginJson` asks of the route's callers.
    expect(blobs[0]!.type).toBe('application/json');
    const [batch] = await batches();
    expect(batch!.sessionId).toMatch(SESSION_ID_PATTERN);
    expect(batch!.events.map((e) => [e.kind, e.path])).toEqual([['view', '/'], ['view', '/our-story']]);
    expect(JSON.stringify(batch)).not.toContain('secret');
    expect(JSON.stringify(batch)).not.toContain('frag');
    for (const e of batch!.events) expect(Math.abs(e.at - Date.now())).toBeLessThan(5000);
  });

  it('keeps one session id for the tab, in sessionStorage and nowhere persistent', async () => {
    render(<Telemetry />);
    leave();
    const first = (await batches())[0]!.sessionId!;
    expect(window.sessionStorage.getItem('wedding.visit')).toBe(first);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');

    // A full page load in the same tab: the module state is gone, the storage is not.
    resetTelemetry();
    visit('/privacy');
    render(<Telemetry />);
    leave();
    expect((await batches()).at(-1)!.sessionId).toBe(first);
  });

  it('flushes on a short timer without waiting for the page to be left', async () => {
    vi.useFakeTimers();
    render(<Telemetry />);
    expect(sendBeacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2100);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('reports an uncaught error once per distinct message, and at most ten per page load', async () => {
    render(<Telemetry />);
    const boom = new TypeError('cannot read label');
    window.dispatchEvent(new ErrorEvent('error', { error: boom, message: boom.message }));
    window.dispatchEvent(new ErrorEvent('error', { error: boom, message: boom.message }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: new Error('rejected') });
    window.dispatchEvent(rejection);
    for (let i = 0; i < 20; i++) window.dispatchEvent(new ErrorEvent('error', { error: new Error(`distinct ${i}`), message: `distinct ${i}` }));
    leave();

    const events = (await batches()).flatMap((b) => b.events);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(10);
    expect(errors[0]).toMatchObject({ kind: 'error', path: '/', name: 'TypeError', message: 'cannot read label' });
    expect(errors[0]!.stack).toContain('TypeError');
    expect(errors[1]).toMatchObject({ message: 'rejected', name: 'Error' });
    expect(errors.some((e) => e.message?.startsWith('ResizeObserver'))).toBe(false);
    // No batch carries more than five errors: an error's stack is what could outgrow the route's 16 KB cap.
    for (const b of await batches()) {
      expect(b.events.filter((e) => e.kind === 'error').length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(b).length).toBeLessThan(16 * 1024);
    }
  });

  it.each([
    ['Do Not Track', 'doNotTrack', '1'],
    ['Global Privacy Control', 'globalPrivacyControl', true],
  ])('sends no views under %s, and errors without a session id', async (_name, property, value) => {
    Object.defineProperty(navigator, property, { value, configurable: true });
    render(<Telemetry />);
    leave();
    expect(sendBeacon).not.toHaveBeenCalled();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('still a fault'), message: 'still a fault' }));
    leave();
    const all = await batches();
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionId).toBeUndefined();
    expect(all[0]!.events.map((e) => e.kind)).toEqual(['error']);
  });

  it('falls back to fetch with keepalive when a beacon is refused', async () => {
    sendBeacon.mockReturnValueOnce(false);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Telemetry />);
    leave();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' } });
    expect((JSON.parse(init.body as string) as Batch).events[0]).toMatchObject({ kind: 'view', path: '/' });
    vi.unstubAllGlobals();
  });

  it('does nothing, and throws nothing, in a browser with none of the APIs', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
    vi.stubGlobal('fetch', undefined);
    vi.stubGlobal('PerformanceObserver', undefined);
    expect(() => {
      render(<Telemetry />);
      leave();
    }).not.toThrow();
    expect((window as TelemetryWindow).__weddingTelemetry).toBeNull();
    vi.unstubAllGlobals();
  });

  it('survives storage that throws, with a session that lasts the page load', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<Telemetry />);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('with storage blocked'), message: 'with storage blocked' }));
    leave();
    const [batch] = await batches();
    expect(batch!.sessionId).toMatch(SESSION_ID_PATTERN);
    expect(batch!.events.map((e) => e.kind)).toEqual(['view', 'error']);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('knows a design stage’s host the way the app does', () => {
    const hosts = ['dev.kendrick.wedding', 'dev.kendrick.localhost:3000', ...STAGE_IDS.map((s) => `${s}.dev.kendrick.wedding`), 'kendrick.wedding', 'www.kendrick.wedding', 'localhost:3000', 'developer.example', 'sitemap.kendrick.wedding'];
    for (const host of hosts) expect(STAGE_HOST.test(host), host).toBe(isStageHost(host));
    expect(STAGE_HOST.test('wireframe.dev.kendrick.wedding')).toBe(true);
    expect(STAGE_HOST.test('kendrick.wedding')).toBe(false);
  });
});
