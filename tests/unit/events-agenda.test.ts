import { describe, expect, it } from 'vitest';
import { agendaDays, undecided } from '@/domain/events/agenda';

const at = (day: string, time: string) => new Date(`${day}T${time}:00-05:00`).toISOString();
const ev = (id: string, dateIso: string, time: string | null) => ({ id, dateIso, startsAt: time ? at(dateIso, time) : null });

describe('the schedule as an agenda', () => {
  it('groups by day, earliest day first, and orders a day by start time whatever the hand-set order says', () => {
    const days = agendaDays([ev('reception', '2027-07-17', '18:00'), ev('brunch', '2027-07-18', '10:00'), ev('ceremony', '2027-07-17', '16:30'), ev('welcome', '2027-07-16', '19:00')]);
    expect(days.map((d) => d.dateIso)).toEqual(['2027-07-16', '2027-07-17', '2027-07-18']);
    expect(days[1]!.timed.map((e) => e.id)).toEqual(['ceremony', 'reception']);
  });

  it('puts events with no time after the timed ones, in the order they were given', () => {
    const [day] = agendaDays([ev('photos', '2027-07-17', null), ev('ceremony', '2027-07-17', '16:30'), ev('cocktails', '2027-07-17', null)]);
    expect(day!.timed.map((e) => e.id)).toEqual(['ceremony']);
    expect(day!.untimed.map((e) => e.id)).toEqual(['photos', 'cocktails']);
  });

  it('says what a guest would still read as to be confirmed', () => {
    expect(undecided({ startsAt: null, venueSpaceRef: null, dressCode: null, description: 'TODO(Tyler & Sara): what happens.' })).toEqual(['time', 'room', 'dress code', 'what happens']);
    expect(undecided({ startsAt: at('2027-07-17', '16:30'), venueSpaceRef: 'stagg-court', dressCode: 'Cocktail', description: 'Vows, then a kiss.' })).toEqual([]);
  });
});
