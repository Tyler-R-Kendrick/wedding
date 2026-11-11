import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPlannerProvider, TripRenderer, tripActionOf, type TripAction } from '@/components/trip/openui';
import { calendarModel, compose, draftPlan, planEntries, weddingEntries, weekendDate, type SavedItem } from '@/domain/trip-planner';
import { BY_ID, PLACES } from '../unit/trip-planner/fixtures';

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

const programFor = (request: string, saved: SavedItem[] = []) => compose(draftPlan({ request, places: PLACES, saved }), { places: BY_ID, saved });

describe('trip OpenUI library', () => {
  it('renders the composed place cards with their own copy and a details link to the place page', async () => {
    show(programFor('Somewhere for coffee'));
    expect(await screen.findByRole('heading', { level: 3, name: 'Coffee, from our list' })).toBeTruthy();
    const card = screen.getByRole('heading', { level: 4, name: 'Bean House Coffee' }).closest('article')!;
    expect(within(card).getByText('A small roaster with a long counter.')).toBeTruthy();
    const details = within(card).getByRole('link', { name: /Details/ });
    expect(details.getAttribute('href')).toBe('/guests/things-to-do/bean-house');
    expect(details.getAttribute('target')).toBeNull();
  });

  it('the heart fires AddToWeekend with the day and part, and offers to take the place out once saved', async () => {
    const { onAction } = show(programFor('Somewhere for coffee'));
    const card = (await screen.findByRole('heading', { level: 4, name: 'Bean House Coffee' })).closest('article')!;
    const heart = within(card).getByRole('button', { name: 'Add Bean House Coffee to my weekend' });
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    await act(async () => fireEvent.click(heart));
    expect(onAction).toHaveBeenCalledWith({ type: 'AddToWeekend', id: 'bean-house', day: 'sat', part: 'morning' });

    const { onAction: again } = show(programFor('Somewhere for coffee'), [{ id: 'bean-house', day: 'sat', part: 'morning' }]);
    const saved = screen.getAllByRole('button', { name: 'Remove Bean House Coffee from my weekend' })[0]!;
    expect(saved.getAttribute('aria-pressed')).toBe('true');
    await act(async () => fireEvent.click(saved));
    expect(again).toHaveBeenCalledWith({ type: 'RemoveFromWeekend', id: 'bean-house' });
  });

  it('a Choice option sends the follow-up request', async () => {
    const { onAction } = show(programFor('What should I do?'));
    const option = await screen.findByRole('button', { name: 'Food and drink' });
    await act(async () => fireEvent.click(option));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'Ask', message: 'Food and drink' }));
    expect(option.getAttribute('aria-pressed')).toBe('true');
  });

  it('a Next chip sends its request', async () => {
    const { onAction } = show(programFor('Somewhere for coffee'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Where should we get dinner?' })));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'Ask', message: 'Where should we get dinner?' }));
  });

  it('the time tool totals the ticked rows, and the total changes when a row is ticked', async () => {
    show(programFor('I have two hours'));
    const total = () => screen.getByText(/^Planned: \d+ of \d+ min$/).textContent;
    await screen.findByText(/^Planned:/);
    const before = total();
    expect(before).toBe('Planned: 105 of 120 min');
    expect(screen.getByText('Fits')).toBeTruthy();
    const row = screen.getByRole('checkbox', { name: /Hotel Cafe/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
    await act(async () => fireEvent.click(row));
    expect(total()).toBe('Planned: 135 of 120 min');
    expect(screen.getByText('Over by 15 min')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Hotel Cafe/ }).getAttribute('aria-checked')).toBe('true');
    // The keyboard does the same.
    await act(async () => fireEvent.keyDown(screen.getByRole('checkbox', { name: /Hotel Cafe/ }), { key: ' ' }));
    expect(total()).toBe('Planned: 105 of 120 min');
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
    expect(screen.getByText(/^Pin: /)).toBeTruthy();
  });

  it('the calendar lists a wedding event as to be announced, and the button fires ExportCalendar', async () => {
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
    expect(screen.getByText('The Steakhouse')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to my calendar' })));
    expect(onAction).toHaveBeenCalledWith({ type: 'ExportCalendar' });
  });

  it('"Use this plan" sends SetWeekend with only valid slots', async () => {
    const { onAction } = show(programFor('Plan my whole weekend'));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Use this plan' })));
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

  it('a CC BY photograph shows its credit under the picture, linked to its source in a new tab', async () => {
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
    expect(screen.getByRole('img', { name: 'The park path' }).closest('figure')?.querySelector('figcaption')).toBeNull();
  });

  it('tripActionOf ignores malformed events', () => {
    expect(tripActionOf({ type: 'AddToWeekend', params: {}, humanFriendlyMessage: '' })).toBeNull();
    expect(tripActionOf({ type: 'SetWeekend', params: { items: [{ id: 'x', day: 'mon', part: 'noon' }] }, humanFriendlyMessage: '' })).toBeNull();
    expect(tripActionOf({ type: 'Unknown', params: {}, humanFriendlyMessage: '' })).toBeNull();
  });
});
