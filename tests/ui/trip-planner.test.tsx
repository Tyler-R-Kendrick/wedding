import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, dateLabel, eventTime, stayFacts, weekendDate, type WeddingEventInput } from '@/domain/trip-planner';
import { profileOf, withPrefs, type TripPrefs, type TripProfile } from '@/domain/trip-planner/profile';
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
  // The guest's own plans: a first save gets an item id, a later one keeps it.
  const saveOwn = vi.fn(async (input: { itemId?: string; title: string; day: string; part: string; date?: string }) => ({ ok: true as const, itemId: input.itemId ?? ITEM(90 + input.title.length) }));
  const removeOwn = vi.fn(async (_input: { itemId: string }) => ({ ok: true as const }));
  const props: Props = { places: PLACES, saved: [], bookings: [], events: EVENTS, hotel: null, actions: { save, remove, saveOwn, removeOwn }, ...over };
  // A test that brings its own search keeps the same stand-in saves.
  if (over.actions) props.actions = { ...over.actions, save, remove, saveOwn, removeOwn };
  const utils = render(<TripPlanner {...props} />);
  // The planner opens on My plans; most of these tests are about Things to do, so they start there.
  fireEvent.click(screen.getByRole('tab', { name: /Things to do/ }));
  return { ...utils, save, remove, saveOwn, removeOwn };
}

/** Stand-ins `setup` replaces with its own counted ones; only the extra actions a test adds are kept. */
const baseActions = (): NonNullable<Props['actions']> => ({
  save: async () => ({ ok: true as const, itemId: ITEM(1) }),
  remove: async () => ({ ok: true as const }),
  saveOwn: async () => ({ ok: true as const, itemId: ITEM(2) }),
  removeOwn: async () => ({ ok: true as const }),
});

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
    // One per itinerary with stops (the couple's title where it reads as a phrase), at most six in
    // all, the whole weekend last. The wedding is not offered: it is in the guest's plans already.
    expect(starters).not.toContain('The wedding day');
    expect(starters.slice(0, 4)).toEqual(['I have 45 minutes', 'Two to three hours', 'With kids', 'For the architecture people']);
    expect(starters.at(-1)).toBe('Plan my whole weekend');
    expect(starters.length).toBeLessThanOrEqual(6);
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
    expect(labels).toEqual(['For the architecture people', 'A free Saturday morning', 'I have two hours', 'With kids', 'Where should we get dinner?', 'Plan my whole weekend']);
  });

  it('an answer is whole when it appears and never changes afterwards', async () => {
    local.writeLines.mockImplementation(async ({ onText }) => {
      onText('TITLE: Two counters for a slow start\n');
      return 'TITLE: Two counters for a slow start\nINTRO: Our favourite places for coffee.\n';
    });
    setup();
    await ask('Somewhere for coffee');
    const answer = (await screen.findByRole('heading', { level: 3, name: 'Coffee, from our list' })).closest('.trip-turn__answer')!;
    const first = answer.innerHTML;
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    // Nothing rewrites it once it is on the page: no rewording, no reordering, no dots above it.
    expect(answer.innerHTML).toBe(first);
    expect(local.writeLines).not.toHaveBeenCalled();
    expect(screen.queryByText('Finding the best fit')).toBeNull();
  });

  it('with the matcher ready, the answer waits a moment for the best fit and then appears once', async () => {
    local.matcher = 'ready';
    // The matcher never answers: the planner does not wait on it.
    local.embed.mockImplementation(() => new Promise(() => undefined));
    setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await ask('Somewhere for coffee');
    expect(screen.getByText('Finding the best fit')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 4, name: 'Bean House Coffee' })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1300));
    vi.useRealTimers();
    expect(await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).toBeTruthy();
    expect(screen.queryByText('Finding the best fit')).toBeNull();
  });

  it('Add saves the place as a trip item at the time its button names, the row says where it is, and the tab counts it', async () => {
    const { save } = setup();
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sat', part: 'morning' });
    expect(tab(/My plans/).textContent).toContain('1');
    expect(document.body.textContent).toContain('Bean House Coffee is in your plans, Saturday morning.');
    expect(within(card).getByText('In your plans: Saturday morning')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Add / })).toBeNull();
    // The note sits in the ask box rather than over it, needs no button of its own, and closes with its own.
    const note = screen.getByText(/is in your plans,/).closest('.trip-toast') as HTMLElement;
    expect(note.closest('form')).toBeTruthy();
    expect(within(note).queryByRole('button', { name: /See my plans/ })).toBeNull();
    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Close' })));
    expect(document.body.textContent).not.toContain('is in your plans,');
  });

  it('“Change the time” on a saved place opens My plans with it picked up, and Cancel puts it down', async () => {
    setup({ saved: [{ id: 'bean-house', day: 'sat', part: 'morning', name: 'Bean House Coffee', itemId: ITEM(1) }] });
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Change the time for Bean House Coffee' })));
    expect(tab(/My plans/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Keep Bean House Coffee where it is' }).getAttribute('aria-pressed')).toBe('true');
    // What to do next is said, with the way to call it off.
    const say = screen.getByText('Choose a new time for Bean House Coffee.').closest('[role="status"]') as HTMLElement;
    await act(async () => fireEvent.click(within(say).getByRole('button', { name: /Cancel/ })));
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Bean House Coffee' }));
  });

  it('every free part of a day takes a plan in the guest’s own words, saved as theirs; the wedding’s hours do not', async () => {
    const { saveOwn, removeOwn } = setup();
    await act(async () => fireEvent.click(tab(/My plans/)));
    // Nine parts of three days, less the wedding's afternoon and evening.
    expect(screen.getAllByRole('button', { name: /^Add something to / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Add something to Friday morning',
      'Add something to Friday afternoon',
      'Add something to Friday evening',
      'Add something to Saturday morning',
      'Add something to Sunday morning',
      'Add something to Sunday afternoon',
      'Add something to Sunday evening',
    ]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add something to Friday evening' })));
    const field = screen.getByLabelText('What are you doing on Friday evening?') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect((screen.getByRole('button', { name: 'Add it' }) as HTMLButtonElement).disabled).toBe(true);
    // Escape closes it and gives focus back to the button that opened it.
    await act(async () => fireEvent.keyDown(field, { key: 'Escape' }));
    expect(screen.queryByLabelText('What are you doing on Friday evening?')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add something to Friday evening' }));

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add something to Friday evening' })));
    fireEvent.change(screen.getByLabelText('What are you doing on Friday evening?'), { target: { value: '  Dinner with   family ' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add it' })));
    expect(saveOwn).toHaveBeenCalledWith({ title: 'Dinner with family', day: 'fri', part: 'evening' });
    const friday = screen.getByRole('region', { name: /^Friday/ });
    expect(within(friday).getByRole('heading', { level: 4, name: 'Dinner with family' })).toBeTruthy();
    expect(tab(/My plans/).textContent).toContain('1');
    expect(document.body.textContent).toContain('“Dinner with family” is in your plans, Friday evening.');
    // The part of the day now offers one more, and focus is on that button.
    expect(document.activeElement).toBe(within(friday).getByRole('button', { name: 'Add something to Friday evening' }));
    expect(document.activeElement!.textContent).toBe('Add something else');
    // It moves like any other plan, keeping its item.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Dinner with family' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move here: Dinner with family to Sunday evening' })));
    await waitFor(() => expect(saveOwn).toHaveBeenLastCalledWith({ itemId: ITEM(90 + 'Dinner with family'.length), title: 'Dinner with family', day: 'sun', part: 'evening' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Dinner with family' })));
    await waitFor(() => expect(removeOwn).toHaveBeenCalledWith({ itemId: ITEM(90 + 'Dinner with family'.length) }));
    expect(screen.queryByRole('heading', { level: 4, name: 'Dinner with family' })).toBeNull();
  });

  it('“See our ideas” on a part of a day asks for that time, and what is added from the answers goes there until the chip is closed', async () => {
    const { save } = setup();
    await act(async () => fireEvent.click(tab(/My plans/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add something to Sunday afternoon' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'See our ideas' })));
    expect(tab(/Things to do/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Ideas for Sunday afternoon')).toBeTruthy();
    expect(screen.getByText('Adding to Sunday afternoon')).toBeTruthy();
    const adds = await screen.findAllByRole('button', { name: /^Add .+ to Sunday afternoon$/ });
    expect(screen.queryByRole('button', { name: /^Add .+ to (Friday|Saturday) / })).toBeNull();
    await act(async () => fireEvent.click(adds[0]!));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ day: 'sun', part: 'afternoon' }));
    // Closed, the answers offer their own times again.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop adding to Sunday afternoon' })));
    expect(screen.queryByText('Adding to Sunday afternoon')).toBeNull();
    await ask('Somewhere for coffee');
    expect(await screen.findByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })).toBeTruthy();
  });

  it('told “I’m busy Friday night”, offers to mark that time, and does not answer with places', async () => {
    const { saveOwn, removeOwn } = setup();
    await ask("I'm busy Friday night");
    expect(await screen.findByRole('heading', { level: 3, name: 'Mark that time as busy' })).toBeTruthy();
    const turn = screen.getByText("I'm busy Friday night").closest('li')!;
    expect(turn.querySelector('article.trip-place')).toBeNull();
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Add Busy to Friday evening' })));
    expect(saveOwn).toHaveBeenCalledWith({ title: 'Busy', day: 'fri', part: 'evening' });
    expect(within(turn).getByText('In your plans: Friday evening')).toBeTruthy();
    expect(tab(/My plans/).textContent).toContain('1');
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Remove Busy from Friday evening' })));
    await waitFor(() => expect(removeOwn).toHaveBeenCalled());
    expect(within(turn).getByRole('button', { name: 'Add Busy to Friday evening' })).toBeTruthy();
  });

  it('told of a plan with a day and no part of it, offers each part; the wedding’s hours are never offered', async () => {
    setup();
    await ask('We have a family thing on Saturday');
    expect(await screen.findByRole('heading', { level: 3, name: 'Add “Family thing” to your plans' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Add Family thing to / }).map((b) => b.textContent)).toEqual(['Add to Saturday morning']);
    await ask('add dinner with my parents on Friday');
    expect(await screen.findByRole('button', { name: 'Add Dinner with my parents to Friday evening' })).toBeTruthy();
  });

  it('puts the board back and says so in plain words when a save fails', async () => {
    const { save } = setup();
    save.mockResolvedValueOnce({ ok: false, message: 'We could not save that just now. Please try again in a moment.' } as never);
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })));
    await waitFor(() => expect(document.body.textContent).toContain('We could not save that just now.'));
    expect(tab(/My plans/).textContent).not.toMatch(/\d/);
    expect(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })).toBeTruthy();
  });

  it('keeps an admin preview in memory: Add works and nothing is sent', async () => {
    setup({ actions: undefined });
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })));
    expect(tab(/My plans/).textContent).toContain('1');
    await act(async () => fireEvent.click(tab(/My plans/)));
    expect(screen.getByText(/kept on this page only/)).toBeTruthy();
    // A plan of their own is kept the same way.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add something to Friday morning' })));
    fireEvent.change(screen.getByLabelText('What are you doing on Friday morning?'), { target: { value: 'Busy' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add it' })));
    expect(tab(/My plans/).textContent).toContain('2');
  });

  it('the board moves a place by picking it up and choosing a time, says how long it takes, and removes it with a way to put it back', async () => {
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
    // No time is set for any of them yet: said once for all, not under each.
    expect(within(wedding).queryByText('Time to be announced')).toBeNull();
    expect(screen.getByText('Times to be announced')).toBeTruthy();
    // Picking it up moves nothing: each free part of a day shows Move here where its Add button was.
    expect(screen.queryByRole('button', { name: /^Add something to / })).toBeNull();
    expect(screen.getByText('It is here now')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move here: Bean House Coffee to Sunday afternoon' })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sun', part: 'afternoon' });
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('link', { name: 'Bean House Coffee' }).getAttribute('href')).toBe('/guests/things-to-do/bean-house');
    expect(screen.queryByRole('button', { name: /^Move here/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Bean House Coffee' })));
    expect(remove).toHaveBeenCalledWith({ placeId: 'bean-house' });
    expect(screen.queryByRole('button', { name: 'Remove Bean House Coffee' })).toBeNull();
    // Gone at once, and one tap puts it back where it was.
    expect(screen.getByText('Bean House Coffee is out of your plans.')).toBeTruthy();
    save.mockClear();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Put it back' })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'sun', part: 'afternoon' });
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('link', { name: 'Bean House Coffee' })).toBeTruthy();
    expect(screen.queryByText('Bean House Coffee is out of your plans.')).toBeNull();
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

  it('the plans are never held back: one saved place is enough for the calendar file, and “Show my plans” lists them with the wedding', async () => {
    setup({ saved: [{ id: 'art-museum', day: 'fri', part: 'afternoon', name: 'Art Museum', itemId: ITEM(2) }] });
    await act(async () => fireEvent.click(tab(/My plans/)));
    expect(screen.queryByRole('button', { name: 'Confirm my plans' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Add to my calendar' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(tab(/Things to do/)));
    await ask('What is my weekend looking like?');
    const cal = await screen.findByRole('region', { name: 'Your plans' });
    expect(within(cal).getByText('The Ceremony')).toBeTruthy();
    expect(within(cal).getByText('Time to be announced')).toBeTruthy();
    // A plan is listed by its part of the day, and a day with nothing on it says so.
    expect(within(cal).getByText('Art Museum').closest('li')!.textContent).toBe('AfternoonArt Museum');
    expect(within(cal).getByText('Nothing planned')).toBeTruthy();
    // The summary follows the plans: taken off the board, it is gone from the answer already given.
    await act(async () => fireEvent.click(within(cal).getByRole('button', { name: 'Change my plans' })));
    expect(tab(/My plans/).getAttribute('aria-selected')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Art Museum' })));
    expect(cal.textContent).not.toContain('Art Museum');
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
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to my calendar' })));
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
        actions={{ save, remove: vi.fn(async () => ({ ok: true as const })), saveOwn: vi.fn(async () => ({ ok: true as const, itemId: ITEM(9) })), removeOwn: vi.fn(async () => ({ ok: true as const })) }}
      />,
    );
    expect(screen.getByRole('tab', { name: /My plans/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Things to do/ }).getAttribute('aria-selected')).toBe('false');
    // The flight lands on Thursday, so the plans start then, with its times.
    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days[0]).toBe(dateLabel(thu));
    expect(days).toContain(dateLabel(weekendDate('sun')));
    const thursday = screen.getByRole('region', { name: dateLabel(thu) });
    // Each time in the part of the day it falls in, the time first: 10:00 AM is morning, 1:30 PM afternoon.
    const part = (p: string) => thursday.querySelector(`[data-slot="${thu}-${p}"]`)!.textContent;
    expect(part('morning')).toMatch(/\D10:00 AMFlight in departs/);
    expect(part('afternoon')).toMatch(/\D1:30 PMFlight in lands/);
    // A day more before the stay, when the guest asks for it.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `Here earlier? Add ${dateLabel(wed)}` })));
    expect(screen.getAllByRole('heading', { level: 3 })[0]!.textContent).toBe(dateLabel(wed));
    // A day added and left empty comes off again; a day with something on it does not offer to.
    const wednesday = screen.getByRole('region', { name: dateLabel(wed) });
    expect(within(thursday).queryByRole('button', { name: /^Remove this day/ })).toBeNull();
    await act(async () => fireEvent.click(within(wednesday).getByRole('button', { name: /^Remove this day/ })));
    expect(screen.getAllByRole('heading', { level: 3 })[0]!.textContent).toBe(dateLabel(thu));
    // A saved place moves to Thursday, and is saved with Thursday's date.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Bean House Coffee' })));
    await act(async () => fireEvent.click(within(thursday).getByRole('button', { name: /^Move here: Bean House Coffee to .+ afternoon$/ })));
    expect(save).toHaveBeenCalledWith({ placeId: 'bean-house', day: 'fri', part: 'afternoon', date: thu });
    expect(within(screen.getByRole('region', { name: dateLabel(thu) })).getByRole('link', { name: 'Bean House Coffee' })).toBeTruthy();
  });

  it('a guest who arrives on the wedding day still sees their own check-in beside the wedding', async () => {
    const sat = weekendDate('sat');
    // 3:00 PM in the wedding's zone (Chicago, UTC-5 in July).
    render(
      <TripPlanner
        places={PLACES}
        saved={[]}
        bookings={[{ id: 'h-1', kind: 'hotel', status: 'planned', title: 'Hotel', hotelName: 'The Palmer', startAt: new Date(`${sat}T20:00:00.000Z`).toISOString(), endAt: null, provider: null }]}
        events={SET}
        hotel={null}
        actions={{ save: vi.fn(async () => ({ ok: true as const, itemId: ITEM(1) })), remove: vi.fn(async () => ({ ok: true as const })), saveOwn: vi.fn(async () => ({ ok: true as const, itemId: ITEM(9) })), removeOwn: vi.fn(async () => ({ ok: true as const })) }}
      />,
    );
    const saturday = screen.getByRole('region', { name: /^Saturday/ });
    const wedding = within(saturday).getByRole('list', { name: 'The wedding' }).closest('.trip-slot')!;
    expect(wedding.textContent).toMatch(/\D3:00 PMCheck in at The Palmer/);
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
    // The day's own heading already says which day it is.
    expect(within(friday).getByText('Our room block: check-in')).toBeTruthy();
    expect(within(sunday).getByText('Our room block: check-out')).toBeTruthy();
    expect(within(friday).queryByText(/check-out/)).toBeNull();
  });

  it('the wedding is not a starter, but asked about it answers with the schedule, the room block and what to ask next', async () => {
    setup({ events: SET });
    expect(within(screen.getByRole('group', { name: 'Ideas to start with' })).queryByRole('button', { name: /wedding day/i })).toBeNull();
    await ask('The wedding day');
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
    // One fact was asked for: the room block is not appended to it.
    expect(screen.queryByRole('region', { name: 'Our room block' })).toBeNull();
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
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to my calendar' })));
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
    // Cleared, the thread is gone and the suggestions are back, with the box ready for a new question.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear and start over' })));
    expect(screen.getByRole('button', { name: /A free Saturday morning/ })).toBeTruthy();
    expect(screen.queryByText('Somewhere for coffee')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear and start over' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Ask us about the weekend'));
  });

  it('“Put all of these in my plans” adds and moves, and never takes out a saved place the plan did not list', async () => {
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
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Put all of these in my plans' })));
    expect(remove).not.toHaveBeenCalled();
    expect(tab(/My plans/).textContent).toContain(String(saved.length));
  });

  it('an add and a remove before the save returns end with the place gone on the server too', async () => {
    const { save, remove } = setup();
    let finish: (v: { ok: true; itemId: string }) => void = () => undefined;
    save.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })));
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Remove Bean House Coffee from my plans' })));
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
    await act(async () => fireEvent.click(within(bean).getByRole('button', { name: /^Add Bean House Coffee to / })));
    await act(async () => fireEvent.click(within(corner).getByRole('button', { name: /^Add Corner Roastery to / })));
    expect(tab(/My plans/).textContent).toContain('2');
    await act(async () => finish({ ok: false, message: 'We could not save that just now. Please try again in a moment.' }));
    await waitFor(() => expect(document.body.textContent).toContain('We could not save that just now.'));
    expect(tab(/My plans/).textContent).toContain('1');
    expect(within(corner).getByRole('button', { name: 'Remove Corner Roastery from my plans' })).toBeTruthy();
    expect(within(bean).getByRole('button', { name: /^Add Bean House Coffee to / })).toBeTruthy();
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
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move here: Bean House Coffee to Sunday afternoon' })));
    expect(within(screen.getByRole('region', { name: /^Sunday/ })).getByRole('button', { name: 'Move Bean House Coffee' })).toBe(document.activeElement);

    const first = screen.getByRole('button', { name: 'Remove Art Museum' });
    first.focus();
    await act(async () => fireEvent.click(first));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove The Aquarium' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove The Aquarium' })));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: /^Friday/ }));
  });

  it('a message with a button stays until it is closed or used; a plain one goes by itself, but waits while it is pointed at', async () => {
    const { save } = setup({ saved: [{ id: 'art-museum', day: 'fri', part: 'afternoon', name: 'Art Museum', itemId: ITEM(2) }] });
    await ask('Somewhere for coffee');
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // A plain note: there for a while, then gone.
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' })));
    const added = () => screen.queryByText('Bean House Coffee is in your plans, Saturday morning.');
    expect(added()).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(5_001));
    expect(added()).toBeNull();

    save.mockResolvedValueOnce({ ok: false, message: 'We could not save that just now. Please try again in a moment.' } as never);
    const other = screen.getByRole('heading', { level: 4, name: 'Corner Roastery' }).closest('article')!;
    await act(async () => fireEvent.click(within(other).getByRole('button', { name: /^Add Corner Roastery to / })));
    const message = () => screen.queryByText('We could not save that just now. Please try again in a moment.');
    expect(message()).toBeTruthy();
    fireEvent.mouseEnter(message()!.parentElement!);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(message(), 'kept while pointed at').toBeTruthy();
    fireEvent.mouseLeave(message()!.parentElement!);
    await act(async () => vi.advanceTimersByTime(5_001));
    expect(message(), 'gone once left alone').toBeNull();

    // The way to put a removed plan back is a button: it stays until it is used or closed.
    await act(async () => fireEvent.click(tab(/My plans/)));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Art Museum' })));
    expect(screen.getByRole('button', { name: 'Put it back' })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('button', { name: 'Put it back' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Close/ })));
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
  });

  it('a plain dinner question asks first; answered, it is answered with what they said, with places from outside our list after ours', async () => {
    const searchNearby = vi.fn(async (_query: { kinds: string[]; diet: string[]; meal?: string }, _ours: string[]) => ({
      ok: true as const,
      places: [
        { id: 'osm:node/1', name: 'Potbelly', kind: 'fast_food' as const, cuisine: ['sandwich'], diet: ['vegetarian' as const], address: '1 Calhoun Pl, Chicago', lat: 41.88, lng: -87.63, meters: 600, detail: 'Sandwich · 0.4 mi from our hotel · Tagged vegetarian' },
        { id: 'osm:node/2', name: 'Burrito Beach', kind: 'fast_food' as const, cuisine: ['mexican'], diet: ['vegetarian' as const], lat: 41.89, lng: -87.62, website: 'https://example.org/burrito', meters: 1300, detail: 'Mexican · 0.8 mi from our hotel · Tagged vegetarian' },
      ],
    }));
    const { saveOwn } = setup({ actions: { ...baseActions(), searchNearby } });
    await ask('Where should we get dinner?');
    expect(await screen.findByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toBeTruthy();
    const form = screen.getByText('Any of these at your table?').closest('form')!;
    // Nothing is recommended, and nothing is searched for, until they answer.
    expect(document.querySelector('article.trip-place')).toBeNull();
    expect(searchNearby).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Vegetarian' })));
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'A sit-down meal' })));
    // One kind of meal at a time; several things not eaten.
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Quick and casual' })));
    expect(within(form).getByRole('button', { name: 'A sit-down meal' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(form).getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Show me places' })));

    // Their answer is their turn in the thread; the meal is then answered with it.
    expect(screen.getByText('Vegetarian, Quick and casual')).toBeTruthy();
    const nearby = await screen.findByRole('region', { name: 'Tagged vegetarian, near the hotel' });
    expect(searchNearby).toHaveBeenCalledTimes(1);
    const [query, ours] = searchNearby.mock.calls[0]!;
    expect(query).toMatchObject({ diet: ['vegetarian'], meal: 'quick', kinds: ['fast_food', 'cafe', 'restaurant'] });
    // Only our own places' names go with it, so none is listed twice: nothing the guest typed.
    expect(ours).toEqual(PLACES.map((p) => p.name));
    expect(JSON.stringify(searchNearby.mock.calls[0])).not.toContain('Where should we get dinner');
    const turn = nearby.closest('li')!;
    expect(within(turn).getByText(/We have not checked our own picks for vegetarian menus/)).toBeTruthy();
    // Ours first, then theirs under their own heading, credited, and said not to be ours.
    expect(turn.querySelector('article.trip-place')!.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nearby).getByText(/Not our own picks/)).toBeTruthy();
    expect(within(nearby).getByRole('link', { name: /OpenStreetMap contributors/ }).getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(within(nearby).getByRole('link', { name: /Burrito Beach/ }).getAttribute('target')).toBe('_blank');
    // A place from outside our list goes into the plans as a plan of the guest's own.
    await act(async () => fireEvent.click(within(nearby).getByRole('button', { name: /^Add Potbelly to / })));
    expect(saveOwn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Potbelly' }));
    expect(within(nearby).getByText(/^In your plans: /)).toBeTruthy();

    // Asked once a visit: the next meal is answered at once, still for a vegetarian.
    await ask('Lunch on Sunday?');
    expect(screen.queryAllByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toHaveLength(1);
    await waitFor(() => expect(searchNearby).toHaveBeenCalledTimes(2));
    expect(searchNearby.mock.calls[1]![0]).toMatchObject({ diet: ['vegetarian'] });
    // Clearing the thread clears the questions, not what they told us about themselves.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear and start over' })));
    expect(screen.getByLabelText('Who we are planning for').textContent).toContain('vegetarian');
    await ask('Where should we get dinner?');
    await waitFor(() => expect(searchNearby).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toBeNull();
    // Their answers are theirs to clear, where they are shown; then the question is asked again.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear and start over' })));
    await act(async () => fireEvent.click(within(screen.getByLabelText('Who we are planning for')).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear my answers' })));
    expect(screen.getByLabelText('Who we are planning for').textContent).not.toContain('vegetarian');
    await ask('Where should we get dinner?');
    expect(await screen.findByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Skip this' })));
    expect(screen.getByText('No preference')).toBeTruthy();
    await waitFor(() => expect(searchNearby.mock.calls.at(-1)![0]).toMatchObject({ diet: [] }));
  });

  it('an answer waits for the search and appears once; a search that is slow or fails leaves our own places, with nothing added later', async () => {
    let finish: (v: { ok: false }) => void = () => undefined;
    const searchNearby = vi.fn(() => new Promise<{ ok: false }>((r) => (finish = r)));
    setup({ actions: { ...baseActions(), searchNearby } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await ask('Somewhere for coffee');
    expect(screen.getByText('Finding the best fit')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 4, name: 'Bean House Coffee' })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(4600));
    vi.useRealTimers();
    const answer = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('.trip-turn__answer')!;
    const shown = answer.innerHTML;
    expect(screen.queryByText('Finding the best fit')).toBeNull();
    // The search coming back late changes nothing.
    await act(async () => finish({ ok: false }));
    expect(answer.innerHTML).toBe(shown);
    expect(answer.textContent).not.toMatch(/Also nearby|OpenStreetMap/);
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

describe('who the planner plans for', () => {
  const profile = (over: Partial<TripProfile> = {}): TripProfile => ({ ...profileOf({ adults: 2, children: 1, dietary: 'vegetarian', accessibility: null }, null), ...over });
  const bar = () => screen.getByLabelText('Who we are planning for');
  const answered = (p: TripProfile) => ({ ok: true as const, profile: p, prefs: null, updatedAt: '2027-07-01T00:00:00.000Z', conflict: false });

  it('says who the ideas are for in one line, marks what came from the RSVP, and offers ideas that fit first', () => {
    setup({ profile: profile() });
    expect(bar().textContent).toContain('Planning for');
    expect(bar().textContent).toContain('2 adults and 1 child');
    // One sentence: who, set strong, then what narrows the ideas, each said where it came from.
    expect(bar().querySelector('p')!.textContent).toBe('Planning for 2 adults and 1 child, vegetarian (from your RSVP).');
    expect(bar().querySelector('strong')!.textContent).toBe('2 adults and 1 child');
    const starters = within(screen.getByRole('group', { name: 'Ideas to start with' })).getAllByRole('button').map((b) => b.textContent);
    expect(starters[0]).toContain('A morning out with the kids');
    expect(starters[1]).toContain('Vegetarian dinner near the hotel');
    // One idea for the children, not two; the whole weekend stays last.
    expect(starters.filter((s) => /kids/i.test(s ?? ''))).toHaveLength(1);
    expect(starters.at(-1)).toContain('Plan my whole weekend');
  });

  it('a guest we know nothing more about sees one line and one invitation, nothing presumed', () => {
    setup();
    expect(bar().textContent).toContain('Just you');
    expect(within(bar()).getByRole('button', { name: 'Make the ideas fit you' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(bar()).queryByText(/RSVP/)).toBeNull();
  });

  it('opens its form in place with what is already known ticked, and saves every answer as the guest left it', async () => {
    const savePrefs = vi.fn(async (input: { prefs: TripPrefs }) => answered(withPrefs(profile(), input.prefs)));
    setup({ profile: profile(), prefs: { value: null, updatedAt: null }, actions: { ...baseActions(), savePrefs } });
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    const form = bar().querySelector('form')!;
    expect(within(form).getByRole('button', { name: 'Vegetarian' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(form).getByRole('button', { name: 'Children come along' }).getAttribute('aria-pressed')).toBe('true');
    // What they would spend is one of several: radios, with "No limit" chosen until they say.
    expect((within(form).getByRole('radio', { name: 'No limit' }) as HTMLInputElement).checked).toBe(true);
    expect(within(form).getAllByRole('radio')).toHaveLength(4);
    // The first control of the form has the keyboard.
    expect(document.activeElement).toBe(within(form).getByRole('button', { name: 'Vegetarian' }));
    // Said first, for the whole form: nothing here changes the RSVP.
    expect(form.firstElementChild!.textContent).toBe('These shape the ideas on this page. Your RSVP and your meal at the wedding stay as you left them.');
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Vegetarian' })));
    await act(async () => fireEvent.click(within(form).getByRole('radio', { name: 'Up to $40 each' })));
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Step-free places only' })));
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Museums' })));
    await act(async () => fireEvent.click(within(form).getByRole('button', { name: 'Save' })));
    // Unticking what the RSVP said is an answer too: nothing is put back. Children are as the invitation says, and
    // staying close to the hotel was never touched, so neither is saved as theirs.
    expect(savePrefs).toHaveBeenCalledWith({ prefs: { diet: [], meal: null, budget: 2, stepFree: true, shortWalks: null, interests: ['museum'], kids: null, asked: true }, basedOn: null });
    await waitFor(() => expect(bar().querySelector('form')).toBeNull());
    expect(bar().querySelector('p')!.textContent).toBe('Planning for 2 adults and 1 child, meals up to $40 each, step-free places, museums.');
    expect(screen.getByText('Saved. New ideas will fit this.')).toBeTruthy();
    // Back on the button that opened it.
    expect(document.activeElement).toBe(within(bar()).getByRole('button', { name: 'Change' }));
  });

  it('Escape and Cancel close the form and change nothing', async () => {
    const savePrefs = vi.fn();
    setup({ profile: profile(), actions: { ...baseActions(), savePrefs } });
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Vegan' })));
    await act(async () => fireEvent.keyDown(bar().querySelector('form')!, { key: 'Escape' }));
    expect(bar().querySelector('form')).toBeNull();
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    // A change that was not saved is not remembered.
    expect(within(bar()).getByRole('button', { name: 'Vegan' }).getAttribute('aria-pressed')).toBe('false');
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' })));
    expect(savePrefs).not.toHaveBeenCalled();
    expect(bar().textContent).toContain('vegetarian (from your RSVP)');
  });

  it('a save that fails says so in the form, keeps the answers on the page, and can be tried again', async () => {
    const savePrefs = vi.fn(async () => ({ ok: false as const, message: 'We could not save that just now. Your answers still apply on this page.' }));
    setup({ profile: profile(), actions: { ...baseActions(), savePrefs } });
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Kosher' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })));
    expect(await within(bar()).findByRole('alert')).toHaveProperty('textContent', 'We could not save that just now. Your answers still apply on this page.');
    expect(bar().querySelector('form')).toBeTruthy();
    expect(bar().textContent).toContain('kosher');
    // Tried again, and saved: the chips were never locked out by the failure.
    expect(within(bar()).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('answers changed on another device since are shown, not overwritten', async () => {
    const elsewhere = withPrefs(profile(), { diet: ['halal'], meal: null, budget: null, stepFree: false, shortWalks: false, interests: [], kids: null, asked: true });
    const savePrefs = vi.fn(async () => ({ ok: true as const, profile: elsewhere, prefs: null, updatedAt: '2027-07-02T00:00:00.000Z', conflict: true }));
    setup({ profile: profile(), actions: { ...baseActions(), savePrefs } });
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Vegan' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })));
    await waitFor(() => expect(bar().textContent).toContain('halal'));
    expect(bar().textContent).not.toContain('vegan');
    expect(screen.getByText('These were changed somewhere else a moment ago, so we kept those.')).toBeTruthy();
  });

  it('an answer to the meal question is kept with the guest’s other answers, so it is not asked on another visit', async () => {
    const savePrefs = vi.fn(async (input: { prefs: TripPrefs }) => answered(withPrefs(profileOf(null, null), input.prefs)));
    setup({ actions: { ...baseActions(), savePrefs } });
    await ask('Where should we get dinner?');
    const turn = screen.getByRole('heading', { level: 3, name: 'Two things first, so the places fit' }).closest('li')!;
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Gluten-free' })));
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Show me places' })));
    expect(savePrefs).toHaveBeenCalledWith({ prefs: expect.objectContaining({ diet: ['gluten-free'], asked: true }), basedOn: null });
    await waitFor(() => expect(bar().textContent).toContain('gluten-free'));
  });

  it('a place to eat with no checked price shows our guess as a guess, or a mark where the price would be', async () => {
    // Out in the city: one checked price, one guess, one we cannot tell.
    const places = PLACES.filter((p) => !p.interests.includes('inside-caa')).map((p) =>
      p.id === 'tasting-room' ? { ...p, facts: { priceLevel: 2 as const } } : p.id === 'pizza-place' ? { ...p, facts: { priceGuess: 2 as const } } : p,
    );
    setup({ places, profile: profile({ diet: [], asked: true }) });
    await ask('Dinner on Friday under $40');
    const factsOf = async (name: string) => {
      const card = (await screen.findAllByRole('link', { name }))[0]!.closest('article')!;
      return within(card).getByRole('list', { name: 'Good to know' });
    };
    // A checked price, plainly.
    expect((await factsOf('Tasting Room')).textContent).toContain('$$, $15 to $40 each');
    // Our guess, said as one and set apart.
    const guess = within(await factsOf('Deep Pan Pizza')).getByText('Likely $$, $15 to $40 each');
    expect(guess.className).toBe('trip-place__fact--guess');
    // Not known: the words say so, and the mark where the dollar signs would be is for the eye only.
    const unknown = within(await factsOf('The Steakhouse')).getByText('Price not known');
    expect(unknown.className).toBe('trip-place__fact--unknown');
    const mark = unknown.querySelector('.trip-place__price-mark')!;
    expect(mark.textContent).toBe('$?');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // And it comes after the places whose price is known or guessed to fit, which the answer says.
    const order = [...document.querySelectorAll('.trip-place__name')].map((n) => n.textContent);
    expect(order.indexOf('The Steakhouse')).toBeGreaterThan(order.indexOf('Tasting Room'));
    expect(order.indexOf('The Steakhouse')).toBeGreaterThan(order.indexOf('Deep Pan Pizza'));
    expect(screen.getByText(/Places whose price we do not know come last\./)).toBeTruthy();
  });

  it('two saves from this page in quick succession are sent one after the other, the second starting from the first', async () => {
    // The first save is still on its way when the second is made.
    let finishFirst: (() => void) | undefined;
    const sent: (string | null | undefined)[] = [];
    const savePrefs = vi.fn(async (input: { prefs: TripPrefs; basedOn?: string | null }) => {
      sent.push(input.basedOn);
      if (sent.length === 1) await new Promise<void>((done) => (finishFirst = done));
      return { ...answered(withPrefs(profileOf(null, null), input.prefs)), updatedAt: `2027-07-01T00:00:0${sent.length}.000Z` };
    });
    setup({ actions: { ...baseActions(), savePrefs } });
    await ask('Where should we get dinner?');
    const turn = screen.getByRole('heading', { level: 3, name: 'Two things first, so the places fit' }).closest('li')!;
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Gluten-free' })));
    await act(async () => fireEvent.click(within(turn).getByRole('button', { name: 'Show me places' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Museums' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })));
    // Held back until the first has answered: sent now, it would read as a change made somewhere else.
    expect(sent).toEqual([null]);
    await act(async () => finishFirst!());
    await waitFor(() => expect(sent).toEqual([null, '2027-07-01T00:00:01.000Z']));
    await waitFor(() => expect(screen.getByText('Saved. New ideas will fit this.')).toBeTruthy());
  });

  it('a place says what to know before going, for the guest it is shown to', async () => {
    const places = PLACES.map((p) => (p.id === 'aquarium' ? { ...p, facts: { cost: 'Adults about $40; less when booked ahead.', hours: 'Mo-Su 09:00-17:00', reservations: 'tickets' as const, stepFree: true } } : p));
    setup({ places, profile: profile({ stepFree: true }) });
    await ask('Something for the kids on Sunday morning');
    const card = (await screen.findAllByRole('link', { name: 'The Aquarium' }))[0]!.closest('article')!;
    const know = within(card).getByRole('list', { name: 'Good to know' });
    expect(within(know).getAllByRole('listitem').map((li) => li.textContent!.replace(/\u00a0/g, ' '))).toEqual(['Adults about $40', 'Open 9 am to 5 pm on Sunday', 'Timed tickets, buy ahead', 'Step-free way in']);
  });

  it('a plan for a time the place is shut says so on My plans, where it can be moved', async () => {
    const places = PLACES.map((p) => (p.id === 'steakhouse' ? { ...p, facts: { hours: 'Su,Mo off; Tu-Sa 17:00-22:00' } } : p));
    setup({ places, saved: [{ id: 'steakhouse', day: 'sun', part: 'evening', name: 'The Steakhouse' }] });
    fireEvent.click(screen.getByRole('tab', { name: /My plans/ }));
    const shut = screen.getByText('Closed on Sundays. Move it to another time.');
    expect(shut).toBeTruthy();
    // No time of day is printed for a visit that cannot happen then.
    expect(within(shut.closest('article')!).queryByText(/^Around /)).toBeNull();
  });

  it('coming back to the page brings in what was saved elsewhere, without touching a change still being saved', async () => {
    const refresh = vi.fn(async () => ({ ok: true as const, saved: [{ id: 'aquarium', day: 'sun' as const, part: 'morning' as const, name: 'The Aquarium', itemId: ITEM(7) }], profile: profile({ budget: 2 }), prefs: null, updatedAt: '2027-07-03T00:00:00.000Z' }));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      setup({ profile: profile(), actions: { ...baseActions(), refresh } });
      // Too soon after loading: nothing is asked.
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(refresh).not.toHaveBeenCalled();
      vi.setSystemTime(Date.now() + 20_000);
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(refresh).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(bar().textContent).toContain('meals up to $40 each'));
      expect(screen.getByRole('tab', { name: /My plans/ }).textContent).toContain('1');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('who the planner plans for: the states around it', () => {
  const bar = () => screen.getByLabelText('Who we are planning for');
  it('a guest who saves with nothing ticked is invited again, not offered a change of nothing', async () => {
    setup();
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Make the ideas fit you' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })));
    expect(bar().querySelector('p')!.textContent).toBe('Planning for Just you.');
    expect(within(bar()).getByRole('button', { name: 'Make the ideas fit you' })).toBeTruthy();
  });

  it('one adult who says children come along is not called "just you"', async () => {
    setup();
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Make the ideas fit you' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Children come along' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })));
    expect(bar().querySelector('p')!.textContent).toBe('Planning for You, with children.');
  });

  it('while a save is on its way the answers cannot be changed under it, and a clear that fails says so', async () => {
    let finish: (v: { ok: false; message: string }) => void = () => undefined;
    const savePrefs = vi.fn(() => new Promise<{ ok: false; message: string }>((r) => (finish = r)));
    setup({ profile: { ...profileOf({ adults: 1, children: 0, dietary: 'vegan', accessibility: null }, { diet: ['vegan'], meal: null, budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: true }) }, actions: { ...baseActions(), savePrefs } });
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Change' })));
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Clear my answers' })));
    expect(within(bar()).getByRole('button', { name: 'Saving' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => fireEvent.click(within(bar()).getByRole('button', { name: 'Kosher' })));
    expect(within(bar()).getByRole('button', { name: 'Kosher' }).getAttribute('aria-pressed')).toBe('false');
    await act(async () => finish({ ok: false, message: 'x' }));
    expect((await within(bar()).findByRole('alert')).textContent).toBe('We could not clear that just now. Please try again in a moment.');
  });
});
