import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportProblemButton } from '@/components/feedback/ReportProblemButton';
import { ReporterDialog } from '@/components/feedback/ReporterDialog';
import { ReporterLauncher } from '@/components/feedback/ReporterLauncher';
import { flushOutbox, isArmed, outboxCount, setArmed } from '@/components/feedback/reporter-client';
import { addBreadcrumb, captureError, describeElement, installRecorder, snapshot } from '@/lib/diagnostics/recorder';
import { FEEDBACK_PATH, REPORTER_FLAG_KEY, REPORTER_GLOBAL, REPORTER_OUTBOX_KEY } from '@/lib/feedback/constants';
import { reporterHotkeyScript } from '@/lib/feedback/hotkey-script';

/** jsdom has the element but not the modal behaviour; the platform's own is what ships. */
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>)[REPORTER_GLOBAL];
});

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the shortcut script', () => {
  /** Runs the inline script against stand-ins, and returns what a key press does. */
  function press(opts: { armed: boolean; hook?: () => void; event?: Partial<KeyboardEvent> }) {
    let handler: (e: unknown) => void = () => undefined;
    const location = { href: '', pathname: '/rsvp/step' };
    const win: Record<string, unknown> = opts.hook ? { [REPORTER_GLOBAL]: opts.hook } : {};
    const storage = { getItem: (key: string) => (opts.armed && key === REPORTER_FLAG_KEY ? '1' : null) };
    new Function('document', 'window', 'localStorage', 'location', reporterHotkeyScript())({ addEventListener: (_: string, fn: (e: unknown) => void) => (handler = fn) }, win, storage, location);
    const preventDefault = vi.fn();
    handler({ code: 'KeyB', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, ...opts.event, preventDefault });
    return { location, prevented: preventDefault.mock.calls.length > 0 };
  }

  it('does nothing on a device that is not the couple’s', () => {
    const hook = vi.fn();
    const { location, prevented } = press({ armed: false, hook });
    expect(hook).not.toHaveBeenCalled();
    expect(location.href).toBe('');
    expect(prevented).toBe(false);
  });

  it('opens the widget when the widget is alive', () => {
    const hook = vi.fn();
    const { location, prevented } = press({ armed: true, hook });
    expect(hook).toHaveBeenCalledOnce();
    expect(location.href).toBe('');
    expect(prevented).toBe(true);
  });

  it('goes to the plain form when the widget is not there, or throws', () => {
    expect(press({ armed: true }).location.href).toBe(`${FEEDBACK_PATH}?from=%2Frsvp%2Fstep`);
    const broken = () => {
      throw new Error('chunk failed to load');
    };
    expect(press({ armed: true, hook: broken }).location.href).toBe(`${FEEDBACK_PATH}?from=%2Frsvp%2Fstep`);
  });

  it('answers only to Alt+Shift+B, by physical key', () => {
    for (const event of [{ code: 'KeyV' }, { altKey: false }, { shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { repeat: true }]) {
      const hook = vi.fn();
      press({ armed: true, hook, event });
      expect(hook, JSON.stringify(event)).not.toHaveBeenCalled();
    }
  });
});

describe('the flight recorder', () => {
  it('describes a control by what it is, never by the words on it', () => {
    document.body.innerHTML = '<a href="/guests/01HZX4K9M2N8P7Q6R5S4T3V2W1?t=secret" class="link-block wide"><span id="inner">Aunt Jane Smith</span></a><button type="submit" name="answer" class="btn btn--primary">Send for Jane</button>';
    expect(describeElement(document.getElementById('inner'))).toBe('a.link-block.wide -> /guests/:id?t');
    expect(describeElement(document.querySelector('button'))).toBe('button.btn.btn--primary[type=submit][name=answer]');
    expect(describeElement(document.getElementById('inner'))).not.toContain('Jane');
  });

  it('keeps the last steps and errors, scrubbed, and reports an error once', () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    installRecorder();
    for (let i = 0; i < 70; i++) addBreadcrumb('note', `step ${i} for jane@example.com`);
    const boom = Object.assign(new Error('render failed'), { digest: '24680' });
    captureError(boom, 'boundary');
    captureError(boom, 'boundary');
    captureError('handled and logged', 'console');
    const taken = snapshot();
    expect(taken.breadcrumbs).toHaveLength(50);
    expect(taken.breadcrumbs.every((c) => !c.text.includes('jane@'))).toBe(true);
    expect(taken.errors.map((e) => e.source)).toEqual(['boundary', 'boundary', 'console']);
    expect(taken.errors[0]).toMatchObject({ message: 'Error: render failed', digest: '24680' });
    expect(taken.session).toMatch(/^[0-9a-f]{16}$/);
    // Twice caught, once sent; a console error is recorded and never sent.
    expect(beacon).toHaveBeenCalledOnce();
    expect((beacon.mock.calls[0] as unknown[])[0]).toBe('/api/pulse');
  });
});

describe('the launcher', () => {
  it('renders nothing and installs nothing for a guest', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ReporterLauncher />);
    expect(container.innerHTML).toBe('');
    expect((window as unknown as Record<string, unknown>)[REPORTER_GLOBAL]).toBeUndefined();
    // Not armed and not on an admin page: it does not even ask who is reading.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the dialog on an armed device, and keeps the device armed when sign-in does not answer', async () => {
    setArmed(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    render(<ReporterLauncher />);
    const open = (window as unknown as Record<string, () => void>)[REPORTER_GLOBAL];
    expect(typeof open).toBe('function');
    act(() => open!());
    expect(await screen.findByRole('heading', { name: 'Report a problem' })).toBeTruthy();
    expect(isArmed()).toBe(true);
  });

  it('disarms the device and forgets the pass when the session says the reader is not an owner', async () => {
    setArmed(true);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : answer({ signedIn: false, admin: false, reporter: false, portals: [] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<ReporterLauncher />);
    await waitFor(() => expect(isArmed()).toBe(false));
    expect(fetchMock.mock.calls.some(([url, init]) => url === FEEDBACK_PATH && init?.method === 'DELETE')).toBe(true);
    expect((window as unknown as Record<string, unknown>)[REPORTER_GLOBAL]).toBeUndefined();
  });
});

describe('the error-page button', () => {
  it('is not there for a guest', () => {
    const { container } = render(<ReportProblemButton digest="123" />);
    expect(container.innerHTML).toBe('');
  });

  it('is a link to the plain form carrying the error reference, on the couple’s devices', () => {
    setArmed(true);
    render(<ReportProblemButton digest="24680" />);
    expect(screen.getByRole('link', { name: 'Report this problem' }).getAttribute('href')).toBe(`${FEEDBACK_PATH}?from=%2F&digest=24680`);
  });
});

describe('the dialog', () => {
  const open = () => render(<ReporterDialog request={{ n: 1 }} />);
  const type = (text: string) => fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: text } });
  const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

  it('has a visible label for every field and says what is sent', () => {
    open();
    expect(screen.getByRole('group', { name: 'What kind of thing is it?' })).toBeTruthy();
    expect((screen.getByLabelText('Something is broken') as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('What happened?'));
    expect(screen.getByLabelText(/Screenshot/).getAttribute('type')).toBe('file');
    expect(screen.getByText(/Nothing typed into the site/)).toBeTruthy();
  });

  it('will not send an empty report', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    open();
    send();
    expect(screen.getByRole('alert').textContent).toContain('Say what happened before sending.');
    expect(screen.getByLabelText('What happened?').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the words, the kind and the recorder’s snapshot, and shows where it was filed', async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true, ref: 'FB-ABC123', filed: 'tracker', message: 'Filed as WED-12.', issue: { key: 'WED-12', url: 'https://linear.app/couple/issue/WED-12' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    open();
    fireEvent.click(screen.getByLabelText('An idea'));
    type('Show the shuttle times on the schedule.');
    send();
    expect((await screen.findByRole('status')).textContent).toContain('Thank you. Filed as WED-12.');
    expect(screen.getByText('Reference: FB-ABC123')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open WED-12' }).getAttribute('href')).toBe('https://linear.app/couple/issue/WED-12');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FEEDBACK_PATH);
    const sent = JSON.parse(init.body as string) as { kind: string; message: string; diagnostics: { session: string; breadcrumbs: unknown[] } };
    expect(sent).toMatchObject({ kind: 'idea', message: 'Show the shuttle times on the schedule.' });
    expect(sent.diagnostics.session).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps what was typed when the device is no longer recognised, and points at sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    open();
    type('Still here after the refusal.');
    send();
    expect((await screen.findByRole('alert')).textContent).toContain('no longer recognised');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
    expect((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value).toBe('Still here after the refusal.');
    expect(outboxCount()).toBe(0);
  });

  it('saves the report on the device when the site cannot be reached, and sends it on a later page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    open();
    type('The whole site is unreachable from the venue Wi-Fi.');
    send();
    expect((await screen.findByRole('status')).textContent).toContain('saved on this device');
    expect(screen.getByRole('button', { name: 'Copy the report' })).toBeTruthy();
    expect(outboxCount()).toBe(1);

    const later = vi.fn(async () => answer({ ok: true, ref: 'FB-LATER1', filed: 'tracker', message: 'Filed.' }, 201));
    vi.stubGlobal('fetch', later);
    expect(await flushOutbox()).toBe(1);
    expect(outboxCount()).toBe(0);
    expect(localStorage.getItem(REPORTER_OUTBOX_KEY)).toBeNull();
    const body = JSON.parse((later.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { message: string };
    expect(body.message).toContain('The whole site is unreachable from the venue Wi-Fi.');
    expect(body.message).toContain('before it could be sent');
  });

  it('treats a server that is down like no server at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    open();
    type('Every request returns 502.');
    send();
    expect((await screen.findByRole('status')).textContent).toContain('saved on this device');
    expect(outboxCount()).toBe(1);
  });

  it('shows the server’s own words when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ok: false, error: 'rate_limited', message: 'That is a lot of reports in a few minutes. Wait a little and send it again.' }, 429)));
    open();
    type('One more.');
    send();
    expect((await screen.findByRole('alert')).textContent).toContain('That is a lot of reports in a few minutes.');
    expect(outboxCount()).toBe(0);
  });
});
