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
  // A textarea since level 12 (the invitation says "in your own words", and a single-line field was
  // 209px wide in the narrower design), so the native setter has to come from that prototype:
  // HTMLInputElement's throws "'set value' called on an object that is not a valid instance".
  const input = screen.getByTestId('concierge-input') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
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
    const input = screen.getByTestId('concierge-input') as HTMLTextAreaElement;
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

  it('never shows a guest the browser’s own exception text', async () => {
    // The other half of the rule above. A message the SERVER wrote is for the guest and is shown as
    // it stands; an exception the browser threw is not, and "Failed to fetch" was reaching the panel
    // verbatim for anything that never completed — an offline phone, a dropped connection, a
    // blocking extension. It also left the turn's "THE CONCIERGE" label over an empty bubble.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await open();
    await ask('When is the wedding?');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).not.toContain('Failed to fetch');
    expect(alert).toContain('the connection dropped');
    // The guest's own question stays — losing what they typed would be worse than the failure — but
    // the concierge's turn is dropped rather than left as a "THE CONCIERGE" label over an empty bubble.
    const turns = [...document.querySelectorAll('.cq__log li')];
    expect(turns).toHaveLength(1);
    expect(turns[0]!.className).toContain('cq__turn--guest');
    expect(turns[0]!.textContent).toContain('When is the wedding?');
    expect(document.querySelector('.cq__turn--concierge')).toBeNull();
    expect((screen.getByTestId('concierge-send') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the primary action in the tab order even with an empty field', async () => {
    // A `disabled` button leaves the tab order entirely, so Tab from an empty input skipped the Ask
    // button and left the panel. `aria-disabled` states the same thing to assistive technology while
    // keeping the control reachable; `submit` ignores a question shorter than two characters.
    await open();
    const send = screen.getByTestId('concierge-send') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
  });

  it('announces new turns and keeps the list a list', async () => {
    // `role="log"` belongs on a wrapper: an explicit role REPLACES the element's implicit one, so
    // putting it on the <ol> stopped it being a list and orphaned every <li> (axe: `listitem`,
    // serious, 2 nodes). Both jobs, two elements.
    vi.stubGlobal('fetch', stubStream(grounded));
    await open();
    await ask('When is the wedding?');
    await waitFor(() => expect(screen.getByText(/Based on:/)).toBeTruthy());
    const log = document.querySelector('[role="log"]');
    expect(log?.getAttribute('aria-live')).toBe('polite');
    expect(log?.tagName).not.toBe('OL');
    expect(document.querySelector('.cq__log')?.tagName).toBe('OL');
    expect(document.querySelector('.cq__log')?.hasAttribute('role')).toBe(false);
  });
});

/**
 * The on-device path in the browser. `LanguageModel` is a global in Chrome; stubbing it is exactly
 * what a supporting browser looks like from here. What matters is that the panel asks for evidence,
 * writes the sentences locally, sends the draft back for verification, and — whenever any of that
 * fails — still ends up showing the server's own verified answer.
 */
describe('the concierge on the guest\'s own device', () => {
  const evidence: ConciergeEvent[] = [
    { type: 'session', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', answerId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
    { type: 'status', stage: 'routing', tools: ['site_status'] },
    { type: 'evidence', system: 'Answer only from the evidence.', userTurn: 'Q: when?\n\n[S1] The wedding is on Saturday, July 17, 2027.' },
  ];

  /** A fetch that answers the evidence request first and the draft request second. */
  function stubTwoPhase(second: ConciergeEvent[] = grounded) {
    const bodies: Record<string, unknown>[] = [];
    const encoder = new TextEncoder();
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      const events = body.mode === 'evidence' ? evidence : second;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const e of events) controller.enqueue(encoder.encode(encodeEvent(e)));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    });
    return { fetch, bodies };
  }

  /** Records what the device was grounded with, so a test can prove it was not the bare question. */
  function stubDevice(prompt: (input: string) => Promise<string>) {
    const seen = { system: '', asked: '' };
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async (options?: { initialPrompts?: { role: string; content: string }[] }) => {
        seen.system = options?.initialPrompts?.find((p) => p.role === 'system')?.content ?? '';
        return {
          prompt: (input: string) => { seen.asked = input; return prompt(input); },
          destroy: () => {},
        };
      },
    });
    return seen;
  }

  it('asks for evidence, answers on device, and sends the draft back to be verified', async () => {
    const { fetch, bodies } = stubTwoPhase();
    vi.stubGlobal('fetch', fetch);
    const seen = stubDevice(async () => 'The wedding is on Saturday, July 17, 2027 [S1].');
    await open();
    await ask('when is the wedding?');
    await screen.findByText(/July 17, 2027/);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ mode: 'evidence', message: 'when is the wedding?' });
    // The device answered under the server's closed-world contract, from the server's evidence —
    // not from the bare question, which is the whole difference between this and a chatbot.
    expect(seen.system).toBe('Answer only from the evidence.');
    expect(seen.asked).toContain('[S1] The wedding is on Saturday, July 17, 2027.');
    // The second request carries the draft and the session the first one opened.
    expect(bodies[1]).toMatchObject({ draft: 'The wedding is on Saturday, July 17, 2027 [S1].', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    expect(bodies[1]).not.toHaveProperty('mode');
  });

  it('falls back to the server when the device cannot answer', async () => {
    const { fetch, bodies } = stubTwoPhase();
    vi.stubGlobal('fetch', fetch);
    stubDevice(async () => { throw new Error('out of memory'); });
    await open();
    await ask('when is the wedding?');
    await screen.findByText(/July 17, 2027/);
    // Still two requests, but the second one asks the server to write the answer itself.
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('draft');
  });

  it('does not ask twice when the server refused before handing over evidence', async () => {
    const refusal: ConciergeEvent[] = [
      { type: 'session', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', answerId: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
      { type: 'refusal', message: 'That is personal to your invitation.', links: [{ label: 'Sign in', href: '/your-weekend' }] },
      { type: 'done', status: 'refused', dropped: 0, latencyMs: 4 },
    ];
    const encoder = new TextEncoder();
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const e of refusal) controller.enqueue(encoder.encode(encodeEvent(e)));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    });
    vi.stubGlobal('fetch', fetch);
    stubDevice(async () => 'anything at all');
    await open();
    await ask('which table am I at?');
    await screen.findByText(/personal to your invitation/);
    expect(bodies).toHaveLength(1);
  });

  it('uses the server alone on a browser with no Prompt API', async () => {
    const fetch = stubStream(grounded);
    vi.stubGlobal('fetch', fetch);
    await open();
    await ask('when is the wedding?');
    await screen.findByText(/July 17, 2027/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).not.toHaveProperty('mode');
  });
});
