import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { weekendDate, type WeddingEventInput } from '@/domain/trip-planner';
import { PLACES } from '../unit/trip-planner/fixtures';

/**
 * The Your Trip planner, end to end inside the browser half: the local models and dictation are
 * replaced (none of them is ever required), the OpenUI answers are the real renderer, and the saves
 * go to stand-in server actions.
 */
const local = vi.hoisted(() => ({
  embed: vi.fn(async () => null as number[][] | null),
  ensureLocal: vi.fn(async () => false),
  writeLines: vi.fn(async (_args: { onText(text: string): void }) => null as string | null),
  matcher: 'unsupported' as string,
}));
vi.mock('@/lib/ai/local', () => ({
  embed: local.embed,
  ensureLocal: local.ensureLocal,
  writeLines: local.writeLines,
  getLocalModels: () => ({ matcher: { state: local.matcher, progress: 0 }, speech: { state: 'unsupported', progress: 0 }, writer: { state: 'unsupported', progress: 0 } }),
}));
const speech = vi.hoisted(() => ({
  route: 'none' as 'none' | 'web-speech' | 'recorder',
  start: vi.fn(),
}));
vi.mock('@/lib/speech', () => ({
  speechSupport: async () => speech.route,
  startDictation: speech.start,
}));

const { TripPlanner } = await import('@/components/trip/TripPlanner');
type Props = Parameters<typeof TripPlanner>[0];

const EVENTS: WeddingEventInput[] = [{ id: 'ev-1', name: 'The Ceremony', dateIso: weekendDate('sat'), startsAt: null, endsAt: null }];
const ITEM = (n: number) => `01ITEM${String(n).padStart(20, '0')}`;

function setup(over: Partial<Props> = {}) {
  // Like the capability: an edit keeps the item's id, an add gets a new one.
  const save = vi.fn(async (input: { placeId: string; itemId?: string | null }) => ({ ok: true as const, itemId: input.itemId ?? ITEM(input.placeId.length) }));
  const remove = vi.fn(async () => ({ ok: true as const }));
  const props: Props = { places: PLACES, saved: [], bookings: [], events: EVENTS, hotel: null, actions: { save, remove }, ...over };
  const utils = render(<TripPlanner {...props} />);
  return { ...utils, save, remove };
}

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Ask us about the weekend'), { target: { value: text } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask' })));
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  local.matcher = 'unsupported';
  local.writeLines.mockReset().mockResolvedValue(null);
  local.embed.mockReset().mockResolvedValue(null);
  speech.route = 'none';
  speech.start.mockReset();
  try {
    sessionStorage.clear();
  } catch {
    // jsdom always has it; the component tolerates its absence.
  }
});
afterEach(() => vi.restoreAllMocks());

describe('the Your Trip planner', () => {
  it('offers starters, and a request answers at once with places from our list, echoing the words', async () => {
    setup();
    expect(screen.getByRole('button', { name: /A free Saturday morning/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Plan my whole weekend/ })).toBeTruthy();
    await ask('Somewhere for coffee');
    expect(screen.getByText('Somewhere for coffee')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).toBeTruthy();
    // The starters give way to the thread, and the box is empty for the next question.
    expect(screen.queryByRole('button', { name: /A free Saturday morning/ })).toBeNull();
    expect((screen.getByLabelText('Ask us about the weekend') as HTMLTextAreaElement).value).toBe('');
    // Nothing on the page names how the answer was made.
    expect(document.body.textContent).not.toMatch(/\b(model|AI|download|device|OpenUI)\b/);
    await waitFor(() => expect(screen.queryByText('Writing back')).toBeNull());
  });

  it('rewords the answer as the written lines arrive, until the guest starts using it', async () => {
    local.writeLines.mockImplementation(async ({ onText }) => {
      onText('TITLE: Two counters for a slow start\n');
      return 'TITLE: Two counters for a slow start\nINTRO: Our favourite places for coffee.\n';
    });
    setup();
    await ask('Somewhere for coffee');
    expect(await screen.findByRole('heading', { name: 'Two counters for a slow start' })).toBeTruthy();
    expect(await screen.findByText('Our favourite places for coffee.')).toBeTruthy();
  });

  it('the heart saves the place as a trip item, with the day and part, and the tab counts it', async () => {
    const { save } = setup();
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sat', part: 'morning', itemId: null });
    expect(tab(/My weekend/).textContent).toContain('1');
    expect(document.body.textContent).toContain('Bean House Coffee is in your weekend, Saturday morning.');
    expect(within(card).getByRole('button', { name: 'Remove Bean House Coffee from my weekend' }).getAttribute('aria-pressed')).toBe('true');
    // The note sits in the ask box rather than over it, and closes with its own button.
    const note = screen.getByText(/is in your weekend/).closest('.trip-toast') as HTMLElement;
    expect(note.closest('form')).toBeTruthy();
    expect(within(note).getByRole('button', { name: /See my weekend/ })).toBeTruthy();
    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Close' })));
    expect(document.body.textContent).not.toContain('is in your weekend');
  });

  it('puts the board back and says so in plain words when a save fails', async () => {
    const { save } = setup();
    save.mockResolvedValueOnce({ ok: false, message: 'We could not save that just now. Please try again in a moment.' } as never);
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    await waitFor(() => expect(document.body.textContent).toContain('We could not save that just now.'));
    expect(tab(/My weekend/).textContent).not.toMatch(/\d/);
    expect(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })).toBeTruthy();
  });

  it('keeps an admin preview in memory: the heart works and nothing is sent', async () => {
    setup({ actions: undefined });
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    expect(tab(/My weekend/).textContent).toContain('1');
    await act(async () => fireEvent.click(tab(/My weekend/)));
    expect(screen.getByText(/kept on this page only/)).toBeTruthy();
  });

  it('the board moves a place with its Move list and removes it, saving each change', async () => {
    const { save, remove } = setup({ saved: [{ id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) }] });
    await act(async () => fireEvent.click(tab(/My weekend/)));
    const sunday = screen.getByRole('region', { name: /^Sunday/ });
    expect(within(sunday).queryByRole('link', { name: 'Bean House Coffee' })).toBeNull();
    // Saturday afternoon and evening belong to the wedding, and are never offered.
    const move = screen.getByRole('combobox', { name: 'Move Bean House Coffee to' }) as HTMLSelectElement;
    expect([...move.options].map((o) => o.value)).not.toContain('sat-afternoon');
    expect(screen.getByText('The wedding')).toBeTruthy();
    await act(async () => fireEvent.change(move, { target: { value: 'sun-afternoon' } }));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sun', part: 'afternoon', itemId: ITEM(1) });
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('link', { name: 'Bean House Coffee' }).getAttribute('href')).toBe('/guests/things-to-do/bean-house');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Bean House Coffee' })));
    expect(remove).toHaveBeenCalledWith({ itemId: ITEM(1) });
    expect(screen.queryByRole('button', { name: 'Remove Bean House Coffee' })).toBeNull();
  });

  it('confirms only from three places, then shows the weekend as a calendar with the wedding in it', async () => {
    const two = [
      { id: 'bean-house', day: 'sat' as const, part: 'morning' as const, name: 'Bean House Coffee', itemId: ITEM(1) },
      { id: 'art-museum', day: 'fri' as const, part: 'afternoon' as const, name: 'Art Museum', itemId: ITEM(2) },
    ];
    const first = setup({ saved: two });
    await act(async () => fireEvent.click(tab(/My weekend/)));
    expect((screen.getByRole('button', { name: 'Confirm my weekend' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save 1 more place to see it as a calendar.')).toBeTruthy();
    first.unmount();

    setup({ saved: [...two, { id: 'aquarium', day: 'sun', part: 'morning', name: 'The Aquarium', itemId: ITEM(3) }] });
    await act(async () => fireEvent.click(tab(/My weekend/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm my weekend' })));
    const cal = await screen.findByRole('region', { name: 'Your weekend' });
    expect(within(cal).getByText('The Ceremony')).toBeTruthy();
    expect(within(cal).getByText('Time to be announced')).toBeTruthy();
    expect(within(cal).getByText('Art Museum')).toBeTruthy();
    expect(within(cal).getByText('The Aquarium')).toBeTruthy();
    expect(sessionStorage.getItem('your-trip:weekend-set')).toBe('1');
  });

  it('“Add to my calendar” saves a calendar file with the wedding, the plan and the bookings', async () => {
    const blobs: Blob[] = [];
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (blobs.push(b as Blob), 'blob:calendar'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('our-wedding-weekend.ics');
    });
    setup({
      saved: [
        { id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) },
        { id: 'art-museum', day: 'fri', part: 'afternoon', name: 'Art Museum', itemId: ITEM(2) },
        { id: 'aquarium', day: 'sun', part: 'morning', name: 'The Aquarium', itemId: ITEM(3) },
      ],
      bookings: [{ id: 'f-1', kind: 'flight', status: 'planned', title: 'Flight home', startAt: `${weekendDate('sun')}T22:00:00.000Z`, endAt: null, provider: null }],
    });
    await act(async () => fireEvent.click(tab(/My weekend/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm my weekend' })));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Add to my calendar' })));
    expect(created).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    const text = await blobs[0]!.text();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    for (const title of ['The Ceremony', 'Bean House Coffee', 'Art Museum', 'The Aquarium', 'Flight home']) expect(text).toContain(`SUMMARY:${title}`);
    expect(document.body.textContent).toContain('Your calendar file is saved.');
  });

  it('a next step from an answer sends it as a new request', async () => {
    setup();
    await ask('Somewhere for coffee');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Where should we get dinner?' })));
    expect(screen.getAllByText('Where should we get dinner?').length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start over' })));
    expect(screen.getByRole('button', { name: /A free Saturday morning/ })).toBeTruthy();
  });

  it('offers no microphone where the browser cannot listen', async () => {
    setup();
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Speak instead' })).toBeNull();
  });

  it('dictates into the box: interim words show, tapping again stops, and nothing is sent', async () => {
    speech.route = 'recorder';
    let opts: { onInterim?(t: string): void; onFinal(t: string): void } | null = null;
    const stop = vi.fn();
    speech.start.mockImplementation((o) => {
      opts = o;
      return { stop, done: new Promise(() => undefined) };
    });
    setup();
    const mic = await screen.findByRole('button', { name: 'Speak instead' });
    await act(async () => fireEvent.click(mic));
    expect(speech.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Stop listening' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => opts!.onInterim?.('a quiet'));
    expect((screen.getByLabelText('Ask us about the weekend') as HTMLTextAreaElement).value).toBe('a quiet');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop listening' })));
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => opts!.onFinal('a quiet morning'));
    expect((screen.getByLabelText('Ask us about the weekend') as HTMLTextAreaElement).value).toBe('a quiet morning');
    // Never auto-sent: still the starters, no thread.
    expect(screen.getByRole('button', { name: /A free Saturday morning/ })).toBeTruthy();
  });
});
