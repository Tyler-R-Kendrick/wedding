import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPlannerProvider, TripRenderer, tripActionOf, type TripAction } from '@/components/trip/openui';
import { calendarModel, compose, draftPlan, planEntries, weddingEntries, weekendDate, type SavedItem } from '@/domain/trip-planner';
import { BY_ID, ITINERARIES, PLACES } from '../unit/trip-planner/fixtures';

/** Composed programs rendered through the real OpenUI <Renderer>, inside the planner's provider. */
function show(program: string, saved: SavedItem[] = []) {
  const onAction = vi.fn<(a: TripAction) => void>();
  const utils = render(
    <TripPlannerProvider places={BY_ID} saved={saved} hotel={{ name: 'Our hotel', lat: 10.001, lng: 20.001 }} onAction={onAction}>
      <TripRenderer response={program} />
    </TripPlannerProvider>,
  );
  return { ...utils, onAction };
}

// Asked already what they eat, so a meal is answered at once.
const programFor = (request: string, saved: SavedItem[] = []) => compose(draftPlan({ request, places: PLACES, saved, prefs: { diet: [], meal: null, asked: true } }), { places: BY_ID, saved });

describe('trip OpenUI library', () => {
  it('renders the composed place rows with their own copy, the name linking to the place page', async () => {
    show(programFor('Somewhere for coffee'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Coffee, from our list' })).toBeTruthy();
    const card = screen.getByRole('heading', { level: 4, name: 'Bean House Coffee' }).closest('article')!;
    expect(within(card).getByText('A small roaster with a long counter.')).toBeTruthy();
    const details = within(card).getByRole('link', { name: 'Bean House Coffee' });
    expect(details.getAttribute('href')).toBe('/guests/things-to-do/bean-house');
    expect(details.getAttribute('target')).toBeNull();
  });

  it('the Add button says where the place will go and fires AddToWeekend; once saved the row says so and offers a new time or to take it out', async () => {
    const { onAction, unmount } = show(programFor('Somewhere for coffee'));
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    const add = within(card).getByRole('button', { name: 'Add Bean House Coffee to Saturday morning' });
    expect(add.textContent).toBe('Add to Saturday morning');
    await act(async () => fireEvent.click(add));
    expect(onAction).toHaveBeenCalledWith({ type: 'AddToWeekend', id: 'bean-house', day: 'sat', part: 'morning' });
    unmount();

    const { onAction: again } = show(programFor('Somewhere for coffee'), [{ id: 'bean-house', day: 'sun', part: 'afternoon' }]);
    const saved = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    expect(within(saved).getByText('In your plans: Sunday afternoon')).toBeTruthy();
    expect(within(saved).queryByRole('button', { name: /^Add / })).toBeNull();
    await act(async () => fireEvent.click(within(saved).getByRole('button', { name: 'Change the time for Bean House Coffee' })));
    expect(again).toHaveBeenCalledWith({ type: 'MovePlan', id: 'bean-house' });
    await act(async () => fireEvent.click(within(saved).getByRole('button', { name: 'Remove Bean House Coffee from my plans' })));
    expect(again).toHaveBeenCalledWith({ type: 'RemoveFromWeekend', id: 'bean-house' });
  });

  it('while the guest is filling a part of a day, every Add goes there and says so', async () => {
    const onAction = vi.fn<(a: TripAction) => void>();
    render(
      <TripPlannerProvider places={BY_ID} saved={[]} target={{ date: weekendDate('fri'), part: 'evening' }} hotel={null} onAction={onAction}>
        <TripRenderer response={'root = Col([a])\na = Place("bean-house", null, "sat", "morning")'} />
      </TripPlannerProvider>,
    );
    expect((await screen.findByRole('button', { name: 'Add Bean House Coffee to Friday evening' })).textContent).toBe('Add to Friday evening');
  });

  it('a Choice option sends the follow-up request', async () => {
    const { onAction } = show(programFor('What should I do?'));
    const option = await screen.findByRole('button', { name: 'Food and drink' });
    await act(async () => fireEvent.click(option));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'Ask', message: 'Food and drink' }));
    expect(option.getAttribute('aria-pressed')).toBe('true');
  });

  it('a picked Choice keeps focus where it was: its options are aria-disabled, not disabled, and a second tap does nothing', async () => {
    const { onAction } = show(programFor('What should I do?'));
    const option = await screen.findByRole('button', { name: 'Food and drink' });
    option.focus();
    await act(async () => fireEvent.click(option));
    for (const b of within(option.closest('fieldset')!).getAllByRole('button')) {
      expect(b.hasAttribute('disabled'), b.textContent!).toBe(false);
      expect(b.getAttribute('aria-disabled'), b.textContent!).toBe('true');
    }
    expect(document.activeElement).toBe(option);
    expect(option.getAttribute('aria-pressed')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Something for the kids' })));
    await act(async () => fireEvent.click(option));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('a Next chip sends its request', async () => {
    const { onAction } = show(programFor('Somewhere for coffee'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Where should we get dinner?' })));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'Ask', message: 'Where should we get dinner?' }));
  });

  it('a request with a length of time shows what fits as places to add: nothing to tick, slide or total', async () => {
    show(programFor('I have two hours'));
    const stops = await screen.findByRole('list', { name: 'The stops, in order' });
    // Each stop says how long it takes; none is given a time of day the guest never named.
    expect(stops.textContent).toMatch(/About (\d+ minutes|an hour)/);
    expect(stops.textContent).not.toMatch(/\d:\d\d/);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Planned:|Fits|Over by/);
    // Every place is a row with one thing to do: add it to a time.
    const rows = [...document.querySelectorAll('article.trip-place')];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(within(r as HTMLElement).getByRole('button', { name: /^Add .+ to (Friday|Saturday|Sunday) (morning|afternoon|evening)$/ })).toBeTruthy();
  });

  it('a long list shows its first three places and the rest on request, with focus on the first that appears', async () => {
    const ids = ['bean-house', 'corner-roastery', 'art-museum', 'park-walk', 'steakhouse', 'aquarium'].filter((id) => BY_ID.has(id));
    expect(ids.length).toBeGreaterThanOrEqual(5);
    show(`root = Col([g])\ng = Grid([${ids.map((id) => `Place("${id}")`).join(', ')}])`);
    await screen.findByRole('heading', { level: 4, name: BY_ID.get(ids[0]!)!.name });
    expect(document.querySelectorAll('article.trip-place')).toHaveLength(3);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `Show ${ids.length - 3} more` })));
    expect(document.querySelectorAll('article.trip-place')).toHaveLength(ids.length);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: BY_ID.get(ids[3]!)!.name }));
  });

  it('four places are shown whole', async () => {
    const ids = ['bean-house', 'art-museum', 'park-walk', 'steakhouse'];
    show(`root = Col([g])\ng = Grid([${ids.map((id) => `Place("${id}")`).join(', ')}])`);
    await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' });
    expect(document.querySelectorAll('article.trip-place')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('the segmented control switches between the hotel and going out', async () => {
    show(programFor('Where should we get dinner?'));
    expect(await screen.findByRole('heading', { name: 'The Rooftop' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'The Steakhouse' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Out and about' })));
    expect(screen.getByRole('heading', { name: 'The Steakhouse' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'The Rooftop' })).toBeNull();
  });

  it('the map shows numbered pins that select a place, and marks the hotel', async () => {
    show(programFor('A walk on Friday afternoon, on foot'));
    const map = await screen.findByRole('img', { name: /Map with \d places and the hotel/ });
    expect(map).toBeTruthy();
    const pins = screen.getAllByRole('button', { name: /^\d\. / });
    expect(pins.length).toBeGreaterThanOrEqual(2);
    await act(async () => fireEvent.click(pins[0]!));
    expect(pins[0]!.getAttribute('aria-pressed')).toBe('true');
    // The chosen pin's name is marked in the list under the map; the map explains nothing in a sentence.
    expect(document.querySelectorAll('.trip-map__legend li.is-selected')).toHaveLength(1);
    expect(map.closest('figure')!.textContent).not.toMatch(/Pins are|Tap a numbered pin/);
  });

  it('draws the pins over the site’s atlas, numbered in plan order, and a chosen pin marks its name in the list', async () => {
    const plan = draftPlan({ request: 'For the architecture people', places: PLACES, saved: [], itineraries: ITINERARIES });
    const { container } = show(compose(plan, { places: BY_ID, saved: [] }));
    const figure = (await screen.findByRole('img', { name: 'Map with 2 places and the hotel' })).closest('figure')!;
    // The ground is the atlas's own files and layers, not a blank rectangle.
    const ground = figure.querySelector('svg.trip-map__ground')!;
    const layers = [...ground.querySelectorAll('use')].map((u) => u.getAttribute('href') ?? '');
    expect(layers.some((h) => /^\/assets\/atlas\/world\.svg\?v=\w+#land$/.test(h))).toBe(true);
    expect(ground.getAttribute('viewBox')).toMatch(/^[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    // Numbered in the itinerary's order, with the route between them.
    const pins = within(figure).getAllByRole('button', { name: /^\d\. / });
    expect(pins.map((b) => b.getAttribute('aria-label'))).toEqual(['1. Walk the Building', '2. River Boat Tour']);
    expect(container.querySelector('.trip-map__route')).toBeTruthy();
    const chosen = () => [...figure.querySelectorAll('.trip-map__legend li.is-selected')].map((li) => li.textContent);
    expect(chosen()).toEqual([]);
    await act(async () => fireEvent.click(pins[1]!));
    expect(pins[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(chosen()).toEqual(['River Boat Tour']);
    await act(async () => fireEvent.click(pins[1]!));
    expect(chosen()).toEqual([]);
  });

  it('moves pins that would cover each other apart, each still a full-size target with a line back to its spot', async () => {
    const program = [
      'root = Col([map])',
      '$stop = ""',
      'map = Map([MapMarker("Walk the Building", 10.001, 20.001, "lobby-tour"), MapMarker("Game Room", 10.001, 20.001, "game-room"), MapMarker("Lakeside Park Walk", 10.004, 20.003, "park-walk")], false, $stop)',
    ].join('\n');
    show(program);
    await screen.findByRole('img', { name: 'Map with 3 places and the hotel' });
    const at = screen.getAllByRole('button', { name: /^\d\. / }).map((b) => `${b.style.left} ${b.style.top}`);
    expect(new Set(at).size).toBe(3);
    expect(document.querySelectorAll('.trip-map__leader').length).toBeGreaterThan(0);
  });

  it('draws no map when every place is under one roof', async () => {
    show(compose(draftPlan({ request: 'A day without leaving the hotel', places: PLACES, saved: [], itineraries: ITINERARIES }), { places: BY_ID, saved: [] }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Stay inside the hotel' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /^Map with/ })).toBeNull();
  });

  it('the plans summary lists a wedding event as to be announced and a plan by its part of the day; its buttons open My plans and the calendar file', async () => {
    const saved: SavedItem[] = [
      { id: 'park-walk', day: 'sat', part: 'morning' },
      { id: 'steakhouse', day: 'fri', part: 'evening' },
      { id: 'art-museum', day: 'sun', part: 'morning' },
    ];
    const plan = draftPlan({ request: 'These are my plans', places: PLACES, saved });
    const entries = [...weddingEntries([{ id: 'w1', name: 'Ceremony and reception', dateIso: weekendDate('sat') }]), ...planEntries(saved, BY_ID)];
    const { onAction } = show(compose(plan, { places: BY_ID, saved, calendar: calendarModel(entries) }), saved);
    const wedding = (await screen.findByText('Ceremony and reception')).closest('li')!;
    expect(wedding.className).toContain('trip-cal__event--wedding');
    expect(within(wedding).getByText('Time to be announced')).toBeTruthy();
    // A plan has a part of the day, never hours we made up for it.
    const dinner = screen.getByText('The Steakhouse').closest('li')!;
    expect(within(dinner).getByText('Evening')).toBeTruthy();
    expect(dinner.textContent).not.toMatch(/\d:\d\d/);
    // Nothing in the summary is drawn as a control: the two buttons under it are the only ones.
    expect(within(screen.getByRole('region', { name: 'Your plans' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Change my plans', 'Add to my calendar']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change my plans' })));
    expect(onAction).toHaveBeenCalledWith({ type: 'OpenPlans' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to my calendar' })));
    expect(onAction).toHaveBeenCalledWith({ type: 'ExportCalendar' });
  });

  it('a plans summary already in the thread follows the plans as they change', async () => {
    const before: SavedItem[] = [{ id: 'steakhouse', day: 'fri', part: 'evening' }];
    const program = compose(draftPlan({ request: 'Show my plans', places: PLACES, saved: before }), { places: BY_ID, saved: before, calendar: calendarModel(planEntries(before, BY_ID)) });
    const now: SavedItem[] = [{ id: 'own:1', own: true, name: 'Dinner with family', day: 'sun', part: 'evening' }];
    render(
      <TripPlannerProvider places={BY_ID} saved={now} calendar={calendarModel(planEntries(now, BY_ID))} hotel={null} onAction={() => {}}>
        <TripRenderer response={program} />
      </TripPlannerProvider>,
    );
    expect(await screen.findByText('Dinner with family')).toBeTruthy();
    expect(screen.queryByText('The Steakhouse')).toBeNull();
    expect(screen.getAllByText('Nothing planned').length).toBeGreaterThan(0);
  });

  it('"Put all of these in my plans" sends SetWeekend with only valid slots', async () => {
    const { onAction } = show(programFor('Plan my whole weekend'));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Put all of these in my plans' })));
    const call = onAction.mock.calls.find(([a]) => a.type === 'SetWeekend')?.[0] as Extract<TripAction, { type: 'SetWeekend' }>;
    expect(call.items.length).toBeGreaterThanOrEqual(4);
    expect(call.items.some((i) => i.day === 'sat' && i.part !== 'morning')).toBe(false);
  });

  it('the Stay and Arrive blocks read the travel domain through the provider', async () => {
    show(programFor('Where should I stay?'));
    expect(await screen.findByRole('link', { name: /Book your room/ })).toBeTruthy();
    expect(screen.getByText('Group code')).toBeTruthy();
    show(programFor('Getting here from the airport'));
    expect(await screen.findByText('Parking at the hotel')).toBeTruthy();
  });

  it('a CC BY photograph shows its credit as the last line of its row, linked to its source in a new tab', async () => {
    const credited = { ...BY_ID.get('art-museum')!, image: { src: '/media/places/x.webp', alt: 'The museum steps', credit: { text: 'Photo: someone, cropped', href: 'https://example.org/photo', license: { name: 'CC BY 2.0', href: 'https://creativecommons.org/licenses/by/2.0/' } } } };
    const plain = { ...BY_ID.get('park-walk')!, image: { src: '/media/places/y.webp', alt: 'The park path' } };
    const places = new Map(BY_ID);
    places.set(credited.id, credited);
    places.set(plain.id, plain);
    render(
      <TripPlannerProvider places={places} saved={[]} hotel={null} onAction={() => {}}>
        <TripRenderer response={'root = Col([a, b])\na = Place("art-museum")\nb = Place("park-walk")'} />
      </TripPlannerProvider>,
    );
    const credit = await screen.findByRole('link', { name: /Photo: someone, cropped/ });
    expect(credit.getAttribute('href')).toBe('https://example.org/photo');
    expect(credit.getAttribute('target')).toBe('_blank');
    // The licence's name links to the licence itself, as CC BY asks.
    const licence = screen.getByRole('link', { name: /CC BY 2\.0/ });
    expect(licence.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/2.0/');
    expect(licence.getAttribute('rel')).toContain('license');
    expect(screen.getByRole('img', { name: 'The museum steps' })).toBeTruthy();
    // A public-domain photo carries no credit line.
    expect(screen.getByRole('img', { name: 'The park path' }).closest('article')!.querySelector('.trip-place__credit')).toBeNull();
    expect(credit.closest('article')!.querySelector('.trip-place__foot')!.lastElementChild).toBe(credit.closest('.trip-place__credit'));
  });

  it("the map lists every stop in the plan's order, numbering a stop without coordinates without giving it a pin", async () => {
    const unlocated = { ...BY_ID.get('lobby-tour')!, id: 'no-spot', name: 'Somewhere Unmapped', lat: undefined, lng: undefined };
    const places = new Map(BY_ID);
    places.set(unlocated.id, unlocated);
    const program = 'root = Col([map])\n$stop = ""\nmap = Map([MapMarker("Art Museum", 10.0, 20.004, "art-museum"), MapMarker("Somewhere Unmapped", null, null, "no-spot"), MapMarker("Bean House Coffee", 10.006, 20.004, "bean-house")], false, $stop)';
    render(
      <TripPlannerProvider places={places} saved={[]} hotel={{ name: 'Our hotel', lat: 10.001, lng: 20.001 }} onAction={() => {}}>
        <TripRenderer response={program} />
      </TripPlannerProvider>,
    );
    const items = await screen.findAllByRole('listitem');
    const legend = items.filter((li) => li.closest('.trip-map__legend'));
    expect(legend.map((li) => [li.getAttribute('value'), li.textContent])).toEqual([
      ['1', 'Art Museum'],
      ['2', 'Somewhere Unmapped (not on the map)'],
      ['3', 'Bean House Coffee'],
    ]);
    // Pins keep the stop's own number, so the third stop is pin 3, not pin 2.
    expect(screen.getByRole('button', { name: '3. Bean House Coffee' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Somewhere Unmapped/ })).toBeNull();
  });

  it('a route lists numbered stops with their time and length, and the way to each from the stop before', async () => {
    render(
      <TripPlannerProvider places={BY_ID} saved={[]} hotel={null} onAction={() => {}}>
        <TripRenderer
          response={[
            'root = Col([r])',
            'r = Route([Stop(1, "lobby-tour", "1:00–1:45 PM", "About 45 minutes"), Stop(2, "park-walk", "2:00–2:45 PM", "About 45 minutes", "Walk about 5 minutes (0.3 mi) to Lakeside Park Walk.", "walk")], "From our hotel: walk about 2 minutes to Walk the Building.")',
          ].join('\n')}
        />
      </TripPlannerProvider>,
    );
    const list = await screen.findByRole('list', { name: 'The stops, in order' });
    expect(list.textContent).toMatch(/From our hotel: walk about 2 minutes/);
    expect(list.textContent).toMatch(/Stop 1: 1:00–1:45 PMAbout 45 minutes/);
    expect(list.textContent).toMatch(/Walk about 5 minutes \(0\.3 mi\) to Lakeside Park Walk\./);
    expect(screen.getByRole('heading', { name: 'Walk the Building' })).toBeTruthy();
    // How long it takes is said once, above the card, not again inside it.
    expect(list.textContent?.match(/About 45 minutes/g)).toHaveLength(2);
  });

  it('every row starts with a picture of the same shape: a photo, else the mark for its kind; and says how long it takes', async () => {
    const photo = { ...BY_ID.get('art-museum')!, image: { src: '/media/places/x.webp', alt: 'The museum steps' } };
    const mapped = { ...BY_ID.get('park-walk')!, image: undefined };
    const nowhere = { ...BY_ID.get('steakhouse')!, image: undefined, lat: undefined, lng: undefined };
    const places = new Map(BY_ID);
    for (const p of [photo, mapped, nowhere]) places.set(p.id, p);
    render(
      <TripPlannerProvider places={places} saved={[]} hotel={null} onAction={() => {}}>
        <TripRenderer response={'root = Col([g])\ng = Grid([Place("art-museum"), Place("park-walk"), Place("steakhouse")])'} />
      </TripPlannerProvider>,
    );
    await screen.findByRole('img', { name: 'The museum steps' });
    const cards = Array.from(document.querySelectorAll('article.trip-place'));
    expect(cards.map((c) => c.firstElementChild?.className)).toEqual([
      expect.stringContaining('trip-place__media'),
      expect.stringContaining('trip-place__media--mark'),
      expect.stringContaining('trip-place__media--mark'),
    ]);
    expect(cards[0]!.firstElementChild!.className).not.toContain('--mark');
    // Until it arrives, the photo's slot is a placeholder of the same size.
    expect(cards[0]!.querySelector('.trip-place__media')!.classList.contains('is-loaded')).toBe(false);
    // Each card says about how long it takes, the couple's own minutes or a guess from its kind.
    for (const c of cards) expect(c.textContent).toMatch(/About (\d+ minutes|an hour|[\d½]+ hours)/);
  });

  it('tripActionOf ignores malformed events', () => {
    expect(tripActionOf({ type: 'AddToWeekend', params: {}, humanFriendlyMessage: '' })).toBeNull();
    expect(tripActionOf({ type: 'SetWeekend', params: { items: [{ id: 'x', day: 'mon', part: 'noon' }] }, humanFriendlyMessage: '' })).toBeNull();
    expect(tripActionOf({ type: 'Unknown', params: {}, humanFriendlyMessage: '' })).toBeNull();
  });
});
