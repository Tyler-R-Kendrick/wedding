import { describe, expect, it } from 'vitest';
import { understand } from '@/domain/trip-planner';

describe('understand', () => {
  it('reads the day and the part of the day', () => {
    expect(understand('Something for Friday afternoon')).toMatchObject({ days: ['fri'], parts: ['afternoon'] });
    expect(understand('sunday morning brunch')).toMatchObject({ days: ['sun'], parts: ['morning'] });
    expect(understand('Where should we get dinner?').parts).toEqual(['evening']);
    expect(understand('what can we do').days).toEqual([]);
  });

  it('reads how long the guest has', () => {
    expect(understand('I only have two hours').minutes).toBe(120);
    expect(understand('we have 90 minutes before check-in').minutes).toBe(90);
    expect(understand('an hour and a half free').minutes).toBe(90);
    expect(understand('about 3 hours').minutes).toBe(180);
    expect(understand('half an hour for coffee').minutes).toBe(30);
    expect(understand('a couple of hours').minutes).toBe(120);
    expect(understand('2.5 hours').minutes).toBe(150);
    expect(understand('coffee please').minutes).toBeNull();
  });

  it('notices kids, rain and walking', () => {
    expect(understand('We are bringing our kids').kids).toBe(true);
    expect(understand('with a toddler and a stroller').kids).toBe(true);
    expect(understand('If it rains on Sunday').indoors).toBe(true);
    expect(understand('Something on foot near the hotel').onFoot).toBe(true);
    expect(understand('Something in the hotel').indoors).toBe(false);
  });

  it('routes stay, arriving, the whole weekend and the calendar', () => {
    expect(understand('Where should I stay?').kind).toBe('stay');
    expect(understand('Compare your room block with other hotels').kind).toBe('stay');
    expect(understand('Coffee near the hotel').kind).toBe('places');
    expect(understand('Getting here from the airport').kind).toBe('arrive');
    expect(understand('Where do I park?').kind).toBe('arrive');
    expect(understand('A walk in the park').kind).toBe('places');
    expect(understand('Where is parking?').kind).toBe('arrive');
    expect(understand('Plan my whole weekend').kind).toBe('weekend');
    expect(understand('These are my plans').kind).toBe('calendar');
    expect(understand('Put my weekend in my calendar').kind).toBe('calendar');
  });

  it('asks when the request is too open', () => {
    expect(understand('What should I do?').kind).toBe('open');
    expect(understand('help').kind).toBe('open');
    expect(understand('coffee').kind).toBe('places');
  });

  it('reads themes', () => {
    expect(understand('Somewhere for coffee').themes).toContain('coffee');
    expect(understand('We love architecture').themes).toContain('architecture');
    expect(understand('a museum or two').themes).toContain('museum');
    expect(understand('a park with a view').themes).toEqual(expect.arrayContaining(['outdoors', 'view']));
  });

  it('flags a request for the wedding itself', () => {
    expect(understand('Saturday evening drinks').weddingTime).toBe(true);
    expect(understand('Saturday morning coffee').weddingTime).toBe(false);
    // Saturday afternoon or evening named beside another day is still the wedding's time.
    expect(understand('Dinner on Saturday or Sunday evening').weddingTime).toBe(true);
    expect(understand('Friday or Saturday night, somewhere for a drink').weddingTime).toBe(true);
    expect(understand('Coffee on Saturday or Sunday morning').weddingTime).toBe(false);
  });
});
