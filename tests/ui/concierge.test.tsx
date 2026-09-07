import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeEvent, type ConciergeEvent } from '@/ai/events';
import { ConciergeSlot } from '@/components/concierge';

/** A fetch that replays a scripted NDJSON stream, one chunk per event, like the real route. */
function stubStream(events: ConciergeEvent[], init: ResponseInit = {}) {
  const encoder = new TextEncoder();
  return vi.fn(async (_input: unknown, _requestInit?: RequestInit) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const e of events) controller.enqueue(encoder.encode(encodeEvent(e)));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/x-ndjson' }, ...init },
    ),
  );
}

const grounded: ConciergeEvent[] = [
  { type: 'session', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', answerId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
  { type: 'status', stage: 'routing', tools: ['site_status'] },
  { type: 'text', text: 'The wedding is on Saturday, July 17, 2027 [S1].' },
  { type: 'sources', sources: [{ marker: 'S1', sourceId: 'brief', title: 'The Wedding', url: '/the-wedding', verifiedAt: '2027-06-01T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING' }] },
  { type: 'done', status: 'grounded', dropped: 0, latencyMs: 12 },
];

async function open() {
  const { container } = render(<ConciergeSlot />);
  await act(async () => {
    screen.getByTestId('concierge-open').click();
  });
  await screen.findByTestId('concierge-input');
  return container;
}

async function ask(question: string) {
  const input = screen.getByTestId('concierge-input') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, question);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('concierge panel', () => {
  it('does not load the panel until a guest asks for it', () => {
    render(<ConciergeSlot />);
    expect(screen.getByTestId('concierge-open')).toBeTruthy();
    expect(screen.queryByTestId('concierge-input')).toBeNull();
  });

  it('has a visible label, a described input, and a keyboard-reachable submit', async () => {
    await open();
    const input = screen.getByTestId('concierge-input') as HTMLInputElement;
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toContain('Ask about the wedding');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('source for every sentence');
    expect((screen.getByTestId('concierge-send') as HTMLButtonElement).type).toBe('submit');
    expect(screen.getByTestId('concierge-status').getAttribute('aria-live')).toBe('polite');
  });

  it('renders the verified answer with its "Based on" citation and the date it was checked', async () => {
    vi.stubGlobal('fetch', stubStream(grounded));
    await open();
    await ask('When is the wedding?');
    await waitFor(() => expect(screen.getByText(/July 17, 2027/)).toBeTruthy());
    expect(screen.getByText('Based on:')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'The Wedding' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/the-wedding');
    expect(screen.getByText(/checked 2027-06-01/)).toBeTruthy();
  });

  it('sends the session id back so a follow-up continues the same conversation', async () => {
    const fetchMock = stubStream(grounded);
    vi.stubGlobal('fetch', fetchMock);
    await open();
    await ask('When is the wedding?');
    await waitFor(() => expect(screen.getByText(/July 17, 2027/)).toBeTruthy());
    await ask('And where?');
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as { sessionId?: string };
    expect(second.sessionId).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('shows a refusal with its links instead of an empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      stubStream([
        { type: 'session', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', answerId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
        { type: 'refusal', message: "I don't have that information yet.", links: [{ label: 'The Wedding', href: '/the-wedding' }] },
        { type: 'done', status: 'refused', dropped: 0, latencyMs: 8 },
      ]),
    );
    await open();
    await ask('What is the weather in Paris?');
    await waitFor(() => expect(screen.getByText(/don't have that information/)).toBeTruthy());
    expect((screen.getByRole('link', { name: 'The Wedding' }) as HTMLAnchorElement).getAttribute('href')).toBe('/the-wedding');
  });

  it('renders a confirmation as a link to the website, never as a completed action', async () => {
    vi.stubGlobal(
      'fetch',
      stubStream([
        { type: 'session', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', answerId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
        { type: 'confirmation', card: { capability: 'submit_rsvp', title: 'Submit your RSVP', summary: 'This needs your confirmation on the website before anything changes.', reviewRoute: '/rsvp', reason: 'requires_ui' } },
        { type: 'refusal', message: 'Review it on the website.', links: [] },
        { type: 'done', status: 'confirmation', dropped: 0, latencyMs: 9 },
      ]),
    );
    await open();
    await ask('Please submit my RSVP as attending.');
    await waitFor(() => expect(screen.getByText('Submit your RSVP')).toBeTruthy());
    const confirm = screen.getByRole('link', { name: /Review and confirm on the website/ }) as HTMLAnchorElement;
    expect(confirm.getAttribute('href')).toBe('/rsvp');
  });

  it('says so when the concierge is unavailable, and leaves the page usable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'rate_limited', message: 'Too many questions at once.' } }), { status: 429, headers: { 'content-type': 'application/json' } })));
    await open();
    await ask('When is the wedding?');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many questions'));
  });
});
