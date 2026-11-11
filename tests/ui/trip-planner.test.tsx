import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, dateLabel, eventTime, stayFacts, weekendDate, type WeddingEventInput } from '@/domain/trip-planner';
import { ITINERARIES, PLACES } from '../unit/trip-planner/fixtures';

/**
 * The Your Trip planner, end to end inside the browser half: the local models and dictation are
 * replaced (none of them is ever required), the OpenUI answers are the real renderer, and the saves
 * go to stand-in server actions.
 */
const local = vi.hoisted(() => ({
  embed: vi.fn(async () => null as number[][] | null),
  ensureLocal: vi.fn(async () => false),
  writeLines: vi.fn(async (_args: { onText(text: string): void }) => null as string | null),
  release: vi.fn(),
  holdLocal: vi.fn((_part: string) => () => undefined),
  matcher: 'unsupported' as string,
}));
vi.mock('@/lib/ai/local', () => ({
  embed: local.embed,
  ensureLocal: local.ensureLocal,
  writeLines: local.writeLines,
  holdLocal: local.holdLocal,
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
  const save = vi.fn(async (input: { placeId: string; day: string; part: string }) => ({ ok: true as const, itemId: ITEM(input.placeId.length) }));
  const remove = vi.fn(async (_input: { placeId: string }) => ({ ok: true as const }));
  const props: Props = { places: PLACES, saved: [], bookings: [], events: EVENTS, hotel: null, actions: { save, remove }, ...over };
  const utils = render(<TripPlanner {...props} />);
  // The planner opens on My plans; most of these tests are about Things to do, so they start there.
  fireEvent.click(screen.getByRole('tab', { name: /Things to do/ }));
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
  local.ensureLocal.mockReset().mockResolvedValue(false);
  local.release.mockReset();
  local.holdLocal.mockReset().mockImplementation(() => local.release);
  speech.route = 'none';
  speech.start.mockReset();
  try {
    sessionStorage.clear();
  } catch {
    // jsdom always has it; the component tolerates its absence.
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

  it('lines the starters up with the couple’s own itineraries, and a starter lands on that itinerary', async () => {
    setup({ itineraries: ITINERARIES });
    const starters = within(screen.getByRole('group', { name: 'Ideas to start with' }))
      .getAllByRole('button')
      .map((b) => b.querySelector('.trip-starter__label')?.textContent);
    // The wedding day first, then one per itinerary with stops (the couple's title where it reads as a
    // phrase), at most six in all, the whole weekend last.
    expect(starters).toEqual(['The wedding day', 'I have 45 minutes', 'Two to three hours', 'With kids', 'For the architecture people', 'Plan my whole weekend']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /With kids/ })));
    expect(await screen.findByRole('heading', { level: 3, name: 'With kids' })).toBeTruthy();
    expect(screen.getByText(/^Short legs, short stops\./)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Burger Counter' })).toBeTruthy();
  });

  it('keeps the plain starters where the couple have no itinerary for them', () => {
    setup({ itineraries: ITINERARIES.filter((i) => i.bucket === 'architecture') });
    const labels = within(screen.getByRole('group', { name: 'Ideas to start with' }))
      .getAllByRole('button')
      .map((b) => b.querySelector('.trip-starter__label')?.textContent);
    expect(labels).toEqual(['The wedding day', 'For the architecture people', 'A free Saturday morning', 'I have two hours', 'With kids', 'Plan my whole weekend']);
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
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sat', part: 'morning' });
    expect(tab(/My plans/).textContent).toContain('1');
    expect(document.body.textContent).toContain('Bean House Coffee is in your plans, Saturday morning.');
    expect(within(card).getByRole('button', { name: 'Remove Bean House Coffee from my weekend' }).getAttribute('aria-pressed')).toBe('true');
    // The note sits in the ask box rather than over it, and closes with its own button.
    const note = screen.getByText(/is in your plans/).closest('.trip-toast') as HTMLElement;
    expect(note.closest('form')).toBeTruthy();
    expect(within(note).getByRole('button', { name: /See my plans/ })).toBeTruthy();
    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Close' })));
    expect(document.body.textContent).not.toContain('is in your plans');
  });

  it('puts the board back and says so in plain words when a save fails', async () => {
    const { save } = setup();
    save.mockResolvedValueOnce({ ok: false, message: 'We could not save that just now. Please try again in a moment.' } as never);
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    await waitFor(() => expect(document.body.textContent).toContain('We could not save that just now.'));
    expect(tab(/My plans/).textContent).not.toMatch(/\d/);
    expect(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })).toBeTruthy();
  });

  it('keeps an admin preview in memory: the heart works and nothing is sent', async () => {
    setup({ actions: undefined });
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    expect(tab(/My plans/).textContent).toContain('1');
    await act(async () => fireEvent.click(tab(/My plans/)));
    expect(screen.getByText(/kept on this page only/)).toBeTruthy();
  });

  it('the board moves a place by picking it up and choosing a time, says how long it takes, and removes it', async () => {
    const { save, remove } = setup({ saved: [{ id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) }] });
    await act(async () => fireEvent.click(tab(/My plans/)));
    const sunday = screen.getByRole('region', { name: /^Sunday/ });
    expect(within(sunday).queryByRole('link', { name: 'Bean House Coffee' })).toBeNull();
    // No list to choose from: the card's handle picks it up (dragging it does the same).
    expect(screen.queryByRole('combobox')).toBeNull();
    const card = screen.getByRole('link', { name: 'Bean House Coffee' }).closest('article')!;
    expect(card.textContent).toMatch(/Around \d+:\d\d.*(AM|PM), about (\d+ minutes|an hour|[\d½]+ hours)/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Bean House Coffee' })));
    expect(screen.getByRole('button', { name: 'Keep Bean House Coffee where it is' }).getAttribute('aria-pressed')).toBe('true');
    // Saturday afternoon and evening belong to the wedding, and are never offered.
    const offered = screen.getAllByRole('button', { name: /^Move here/ }).map((b) => b.textContent);
    expect(offered.some((t) => /Saturday (afternoon|evening)/.test(t ?? ''))).toBe(false);
    expect(offered.some((t) => /Saturday morning/.test(t ?? ''))).toBe(false);
    // That slot lists the wedding's own events instead.
    const wedding = screen.getByRole('list', { name: 'The wedding' });
    expect(within(wedding).getByText('The Ceremony')).toBeTruthy();
    expect(within(wedding).getByText('Time to be announced')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Move here: Bean House Coffee to Sunday, .+ afternoon$/ })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sun', part: 'afternoon' });
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('link', { name: 'Bean House Coffee' }).getAttribute('href')).toBe('/guests/things-to-do/bean-house');
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Bean House Coffee' })));
    expect(remove).toHaveBeenCalledWith({ placeId: 'bean-house' });
    expect(screen.queryByRole('button', { name: 'Remove Bean House Coffee' })).toBeNull();
  });

  it('a picked-up place is put back with Escape', async () => {
    setup({ saved: [{ id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) }] });
    await act(async () => fireEvent.click(tab(/My plans/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Bean House Coffee' })));
    expect(screen.getAllByRole('button', { name: /^Move here/ }).length).toBeGreaterThan(0);
    await act(async () => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Bean House Coffee' }));
  });

  it('confirms only from three places, then shows the weekend as a calendar with the wedding in it', async () => {
    const two = [
      { id: 'bean-house', day: 'sat' as const, part: 'morning' as const, name: 'Bean House Coffee', itemId: ITEM(1) },
      { id: 'art-museum', day: 'fri' as const, part: 'afternoon' as const, name: 'Art Museum', itemId: ITEM(2) },
    ];
    const first = setup({ saved: two });
    await act(async () => fireEvent.click(tab(/My plans/)));
    expect((screen.getByRole('button', { name: 'Confirm my plans' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Save 1 more place to see your plans as a calendar.')).toBeTruthy();
    first.unmount();

    setup({ saved: [...two, { id: 'aquarium', day: 'sun', part: 'morning', name: 'The Aquarium', itemId: ITEM(3) }] });
    await act(async () => fireEvent.click(tab(/My plans/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm my plans' })));
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
    await act(async () => fireEvent.click(tab(/My plans/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm my plans' })));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Add to my calendar' })));
    expect(created).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    const text = await blobs[0]!.text();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    for (const title of ['The Ceremony', 'Bean House Coffee', 'Art Museum', 'The Aquarium', 'Flight home']) expect(text).toContain(`SUMMARY:${title}`);
    expect(document.body.textContent).toContain('Your calendar file is saved.');
  });

  // The couple's three events once some details are set; times in UTC, read in the wedding's zone.
  const sat = weekendDate('sat');
  const SET: WeddingEventInput[] = [
    { id: 'ev-c', name: 'Ceremony', dateIso: sat, startsAt: `${sat}T21:30:00.000Z`, endsAt: `${sat}T22:00:00.000Z`, room: 'Garden Room', dressCode: 'Garden formal', description: 'Short and sweet.' },
    { id: 'ev-k', name: 'Cocktail hour', dateIso: sat, startsAt: null, endsAt: null, unconfirmed: true },
    { id: 'ev-r', name: 'Reception', dateIso: sat, startsAt: `${sat}T23:30:00.000Z`, endsAt: null, room: 'Ballroom' },
  ];

  it('opens on My plans: every day of the stay, flights and hotel at their times, a day more on request, and places saved to any day', async () => {
    const thu = addDays(weekendDate('fri'), -1);
    const wed = addDays(thu, -1);
    // Local wedding-zone noon on Thursday, written as the instant it is (any offset works the same).
    const landing = new Date(`${thu}T18:30:00.000Z`).toISOString();
    const save = vi.fn(async (_input: { placeId: string; day: string; part: string; date?: string }) => ({ ok: true as const, itemId: ITEM(1) }));
    render(
      <TripPlanner
        places={PLACES}
        saved={[{ id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) }]}
        bookings={[{ id: 'f-1', kind: 'flight', status: 'planned', title: 'Flight in', startAt: new Date(`${thu}T15:00:00.000Z`).toISOString(), endAt: landing, provider: null }]}
        events={EVENTS}
        hotel={null}
        actions={{ save, remove: vi.fn(async () => ({ ok: true as const })) }}
      />,
    );
    expect(screen.getByRole('tab', { name: /My plans/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Things to do/ }).getAttribute('aria-selected')).toBe('false');
    // The flight lands on Thursday, so the plans start then, with its times.
    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days[0]).toBe(dateLabel(thu));
    expect(days).toContain(dateLabel(weekendDate('sun')));
    const thursday = screen.getByRole('region', { name: dateLabel(thu) });
    expect(thursday.textContent).toMatch(/Flight in: departs \d+:\d\d (AM|PM)/);
    expect(thursday.textContent).toMatch(/Flight in: lands \d+:\d\d (AM|PM)/);
    // A day more before the stay, when the guest asks for it.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Add ${dateLabel(wed)}`) })));
    expect(screen.getAllByRole('heading', { level: 3 })[0]!.textContent).toBe(dateLabel(wed));
    // A saved place moves to Thursday, and is saved with Thursday's date.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Bean House Coffee' })));
    await act(async () => fireEvent.click(within(thursday).getByRole('button', { name: /^Move here: Bean House Coffee to .+ afternoon$/ })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'fri', part: 'afternoon', date: thu });
    expect(within(screen.getByRole('region', { name: dateLabel(thu) })).getByRole('link', { name: 'Bean House Coffee' })).toBeTruthy();
  });

  it('the board lists the wedding\'s events in their slot, and the room block\'s check-in and check-out on Friday and Sunday', async () => {
    const stay = stayFacts();
    setup({ events: SET, stay });
    await act(async () => fireEvent.click(tab(/My plans/)));
    const wedding = screen.getByRole('list', { name: 'The wedding' });
    const rows = within(wedding).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      `Ceremony${eventTime(SET[0]!.startsAt, SET[0]!.endsAt)}Garden RoomDress code: Garden formal`,
      'Cocktail hourTime to be announced',
      `Reception${eventTime(SET[2]!.startsAt)}Ballroom`,
    ]);
    // The block's dates are facts about the block, on the days they fall on.
    const friday = screen.getByRole('region', { name: /^Friday/ });
    const sunday = screen.getByRole('region', { name: /^Sunday/ });
    expect(stay.checkIn).toBe(weekendDate('fri'));
    expect(within(friday).getByText(`Our room block: check-in ${dateLabel(stay.checkIn!)}`)).toBeTruthy();
    expect(within(sunday).getByText(`Our room block: check-out ${dateLabel(stay.checkOut!)}`)).toBeTruthy();
    expect(within(friday).queryByText(/check-out/)).toBeNull();
  });

  it('the wedding day starter comes first, and answers with the schedule, the room block and what to ask next', async () => {
    setup({ events: SET });
    const first = within(screen.getByRole('group', { name: 'Ideas to start with' })).getAllByRole('button')[0]!;
    expect(first.querySelector('.trip-starter__label')?.textContent).toBe('The wedding day');
    await act(async () => fireEvent.click(first));
    expect(await screen.findByRole('heading', { level: 3, name: 'The wedding day' })).toBeTruthy();
    const day = screen.getByRole('region', { name: 'The wedding day' });
    const names = [...day.querySelectorAll('.trip-sched__name')].map((n) => n.textContent);
    expect(names).toEqual(['Ceremony', 'Cocktail hour', 'Reception']);
    expect(within(day).getByText(eventTime(SET[0]!.startsAt, SET[0]!.endsAt)!)).toBeTruthy();
    expect(within(day).getByText('Time to be announced')).toBeTruthy();
    expect(within(day).getByText('Garden Room')).toBeTruthy();
    expect(within(day).getByText('Dress code: Garden formal')).toBeTruthy();
    expect(within(day).getByText('Short and sweet.')).toBeTruthy();
    const block = screen.getByRole('region', { name: 'Our room block' });
    expect(within(block).getByText(/^Our room block: check-in /)).toBeTruthy();
    expect(within(block).getByText(/^Our room block: check-out /)).toBeTruthy();
    expect(within(block).getByText(stayFacts().address)).toBeTruthy();
    expect(within(block).getByRole('link', { name: /Book your room/ })).toBeTruthy();
    for (const next of ['Getting here from the airport', 'A free Saturday morning', 'Where should we get dinner on Friday?']) expect(screen.getByRole('button', { name: next })).toBeTruthy();
    // No written rewording for this answer: the facts stand as they are.
    expect(local.writeLines).not.toHaveBeenCalled();
  });

  it('asked about the ceremony\'s time before it is set, says so plainly', async () => {
    setup();
    await ask('What time is the ceremony?');
    expect(await screen.findByText('We have not announced the time of the ceremony yet. We will put it here as soon as it is set.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'The wedding day' })).getByText('Time to be announced')).toBeTruthy();
  });

  it('the calendar file carries the block\'s check-in and check-out only for a guest staying there', async () => {
    const files: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (void (b as Blob).text().then((t) => files.push(t)), 'blob:calendar'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const saved = [
      { id: 'bean-house', day: 'sat' as const, part: 'morning' as const, name: 'Bean House Coffee', itemId: ITEM(1) },
      { id: 'art-museum', day: 'fri' as const, part: 'afternoon' as const, name: 'Art Museum', itemId: ITEM(2) },
      { id: 'aquarium', day: 'sun' as const, part: 'morning' as const, name: 'The Aquarium', itemId: ITEM(3) },
    ];
    const stay = stayFacts();
    const exportFile = async (bookings: Props['bookings']) => {
      const u = setup({ saved, events: SET, stay, bookings });
      await act(async () => fireEvent.click(tab(/My plans/)));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /Confirm my plans|Show my calendar/ })));
      await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Add to my calendar' })));
      await waitFor(() => expect(files.length).toBeGreaterThan(0));
      u.unmount();
      return files.pop()!.replace(/\r\n /g, '');
    };
    const elsewhere = await exportFile([]);
    expect(elsewhere).toContain('SUMMARY:Ceremony');
    expect(elsewhere).toContain('LOCATION:Garden Room');
    expect(elsewhere).toContain('DESCRIPTION:Short and sweet. Dress code: Garden formal.');
    expect(elsewhere).not.toContain('SUMMARY:Check-in');
    const staying = await exportFile([{ id: 'h-1', kind: 'hotel', status: 'confirmed', title: stay.hotelName, startAt: `${weekendDate('fri')}T21:00:00.000Z`, endAt: `${weekendDate('sun')}T16:00:00.000Z`, provider: null }]);
    expect(staying).toContain(`SUMMARY:Check-in at the ${stay.hotelName}`);
    expect(staying).toContain(`DTSTART;VALUE=DATE:${stay.checkIn!.replace(/-/g, '')}`);
    expect(staying).toContain(`SUMMARY:Check-out at the ${stay.hotelName}`);
  });

  it('a next step from an answer sends it as a new request', async () => {
    setup();
    await ask('Somewhere for coffee');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Where should we get dinner?' })));
    expect(screen.getAllByText('Where should we get dinner?').length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start over' })));
    expect(screen.getByRole('button', { name: /A free Saturday morning/ })).toBeTruthy();
  });

  it('“Use this plan” adds and moves, and never takes out a saved place the plan did not list', async () => {
    const saved = [
      { id: 'lobby-tour', day: 'fri' as const, part: 'morning' as const, name: 'Walk the Building', itemId: ITEM(1) },
      { id: 'park-walk', day: 'fri' as const, part: 'afternoon' as const, name: 'Lakeside Park Walk', itemId: ITEM(2) },
      { id: 'steakhouse', day: 'fri' as const, part: 'evening' as const, name: 'The Steakhouse', itemId: ITEM(3) },
      { id: 'hotel-cafe', day: 'sat' as const, part: 'morning' as const, name: 'Hotel Cafe', itemId: ITEM(4) },
      { id: 'art-museum', day: 'sun' as const, part: 'morning' as const, name: 'Art Museum', itemId: ITEM(5) },
      { id: 'aquarium', day: 'sun' as const, part: 'afternoon' as const, name: 'The Aquarium', itemId: ITEM(6) },
      { id: 'rooftop', day: 'sun' as const, part: 'evening' as const, name: 'The Rooftop', itemId: ITEM(7) },
      // No longer on our list, but still the guest's.
      { id: 'old-favourite', day: 'sun' as const, part: 'evening' as const, name: 'An Old Favourite', itemId: ITEM(8) },
    ];
    const { remove } = setup({ saved });
    await ask('Plan my whole weekend');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Use this plan' })));
    expect(remove).not.toHaveBeenCalled();
    expect(tab(/My plans/).textContent).toContain(String(saved.length));
  });

  it('a heart and an un-heart before the save returns end with the place gone on the server too', async () => {
    const { save, remove } = setup();
    let finish: (v: { ok: true; itemId: string }) => void = () => undefined;
    save.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Remove Bean House Coffee from my weekend' })));
    // The remove waits for the save of the same place, so it cannot run first.
    expect(remove).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, itemId: ITEM(1) }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ placeId: 'bean-house' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(tab(/My plans/).textContent).not.toMatch(/\d/);
  });

  it('a failed save puts back only that place, not a place saved after it', async () => {
    const { save } = setup();
    let finish: (v: { ok: false; message: string }) => void = () => undefined;
    save.mockImplementationOnce(() => new Promise((r) => (finish = r as never)));
    await ask('Somewhere for coffee');
    const bean = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    const corner = screen.getByRole('heading', { level: 4, name: 'Corner Roastery' }).closest('article')!;
    await act(async () => fireEvent.click(within(bean).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    await act(async () => fireEvent.click(within(corner).getByRole('button', { name: 'Add Corner Roastery to my weekend' })));
    expect(tab(/My plans/).textContent).toContain('2');
    await act(async () => finish({ ok: false, message: 'We could not save that just now. Please try again in a moment.' }));
    await waitFor(() => expect(document.body.textContent).toContain('We could not save that just now.'));
    expect(tab(/My plans/).textContent).toContain('1');
    expect(within(corner).getByRole('button', { name: 'Remove Corner Roastery from my weekend' })).toBeTruthy();
    expect(within(bean).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })).toBeTruthy();
  });

  it('keeps keyboard focus on the board: on the moved card’s handle, then on the next card or the day', async () => {
    setup({
      saved: [
        { id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) },
        { id: 'art-museum', day: 'fri', part: 'afternoon', name: 'Art Museum', itemId: ITEM(2) },
        { id: 'aquarium', day: 'fri', part: 'evening', name: 'The Aquarium', itemId: ITEM(3) },
      ],
    });
    await act(async () => fireEvent.click(tab(/My plans/)));
    const grip = screen.getByRole('button', { name: 'Move Bean House Coffee' });
    grip.focus();
    await act(async () => fireEvent.click(grip));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Move here: Bean House Coffee to Sunday, .+ afternoon$/ })));
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('button', { name: 'Move Bean House Coffee' })).toBe(document.activeElement);

    const first = screen.getByRole('button', { name: 'Remove Art Museum' });
    first.focus();
    await act(async () => fireEvent.click(first));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove The Aquarium' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove The Aquarium' })));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: /^Friday/ }));
  });

  it('a message with a button stays until it is closed or used; a plain one waits while it is pointed at', async () => {
    const { save } = setup();
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' })));
    expect(screen.getByRole('button', { name: 'See my plans' })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('button', { name: 'See my plans' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Close/ })));
    expect(screen.queryByRole('button', { name: 'See my plans' })).toBeNull();

    save.mockResolvedValueOnce({ ok: false, message: 'We could not save that just now. Please try again in a moment.' } as never);
    const other = screen.getByRole('heading', { level: 4, name: 'Corner Roastery' }).closest('article')!;
    await act(async () => fireEvent.click(within(other).getByRole('button', { name: 'Add Corner Roastery to my weekend' })));
    const message = () => screen.queryByText('We could not save that just now. Please try again in a moment.');
    expect(message()).toBeTruthy();
    fireEvent.mouseEnter(message()!.parentElement!);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(message(), 'kept while pointed at').toBeTruthy();
    fireEvent.mouseLeave(message()!.parentElement!);
    await act(async () => vi.advanceTimersByTime(5_001));
    expect(message(), 'gone once left alone').toBeNull();
  });

  it('tries the matcher again on a request after a failed background install', async () => {
    local.matcher = 'failed';
    setup();
    await ask('somewhere green and peaceful');
    await waitFor(() => expect(local.ensureLocal).toHaveBeenCalledTimes(1));
    expect(local.ensureLocal).toHaveBeenCalledWith('matcher', { userGesture: true });
  });

  it('holds the matcher while the planner is open, and lets it go when it closes', async () => {
    const { unmount } = setup();
    expect(local.holdLocal).toHaveBeenCalledWith('matcher');
    expect(local.release).not.toHaveBeenCalled();
    unmount();
    expect(local.release).toHaveBeenCalled();
  });

  it('holds the speech model while dictating, and only then', async () => {
    speech.route = 'recorder';
    let end: () => void = () => undefined;
    speech.start.mockImplementation(() => ({ stop: vi.fn(), done: new Promise<void>((r) => (end = r)) }));
    setup();
    const mic = await screen.findByRole('button', { name: 'Speak instead' });
    expect(local.holdLocal).not.toHaveBeenCalledWith('speech');
    await act(async () => fireEvent.click(mic));
    expect(local.holdLocal).toHaveBeenCalledWith('speech');
    const releases = local.release.mock.calls.length;
    await act(async () => end());
    expect(local.release.mock.calls.length).toBe(releases + 1);
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
