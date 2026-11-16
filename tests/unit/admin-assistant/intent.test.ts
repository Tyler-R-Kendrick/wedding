import { describe, expect, it } from 'vitest';
import { route, subjectOf } from '@/domain/admin-assistant';

describe('the console assistant reads a question without a model', () => {
  it.each([
    ['What needs my attention?', 'attention'],
    ['what should I do before we open RSVPs', 'attention'],
    ['How many visits this week?', 'traffic'],
    ['which pages are most popular', 'traffic'],
    ['Who visited today?', 'sessions'],
    ['What errors did guests hit?', 'errors'],
    ['is anything broken for guests', 'errors'],
    ['How many guests have replied?', 'rsvp'],
    ['headcount for the reception', 'rsvp'],
    ['Who has not replied?', 'pending'],
    ['who still needs to RSVP', 'pending'],
    ['Are any jobs stuck?', 'jobs'],
    ['What is slow?', 'metrics'],
    ['What changed recently?', 'activity'],
    ['Where do I edit the hotel block?', 'open'],
    ['What can you do?', 'help'],
  ])('%s → %s', (message, view) => {
    const intent = route(message);
    expect(intent.view).toBe(view);
    expect(intent.confidence).toBeGreaterThan(0);
  });

  it('reads the time window from the words', () => {
    expect(route('visits today').window).toBe(24);
    expect(route('visits this week').window).toBe(168);
    expect(route('errors in the last 30 days').window).toBe(720);
    expect(route('how many visits').window).toBeUndefined();
  });

  it('a verb that changes the lifecycle is about the lifecycle, even when RSVP also names the replies', () => {
    expect(route('Open RSVPs')).toMatchObject({ view: 'lifecycle', state: 'RSVP_OPEN' });
    expect(route('Publish Wedding week')).toMatchObject({ view: 'lifecycle', state: 'WEDDING_WEEK' });
    expect(route('publish Invitations out')).toMatchObject({ view: 'lifecycle', state: 'INVITATIONS_OPEN' });
    expect(route('move the site to SAVE_THE_DATE')).toMatchObject({ view: 'lifecycle', state: 'SAVE_THE_DATE' });
    // Asking about replies does not propose a change.
    expect(route('how many RSVPs are in').view).toBe('rsvp');
  });

  it('sessions that hit an error are a list of sessions, not the error groups', () => {
    expect(route('Which sessions hit an error?')).toMatchObject({ view: 'sessions', withErrors: true });
  });

  it('a name with a visiting verb is one guest', () => {
    const intent = route('What has Ada Testhouse done on the site?');
    expect(intent.view).toBe('guest');
    expect(intent.subject).toBe('Ada Testhouse');
    expect(subjectOf('did "Fin Solo" visit')).toBe('Fin Solo');
  });

  it('refused actions are the audit trail, filtered', () => {
    expect(route('What was refused?')).toMatchObject({ view: 'activity', denied: true });
  });

  it('scores nothing for a message it cannot place, so the caller can ask a model or list what can be asked', () => {
    const intent = route('purple monkey dishwasher');
    expect(intent).toMatchObject({ view: 'help', confidence: 0 });
  });

  it('what the page already knows wins over the words', () => {
    expect(route('anything at all', { view: 'errors', window: 24 })).toMatchObject({ view: 'errors', window: 24 });
    // A choice outside the list is ignored, not trusted.
    expect(route('How many visits this week?', { view: 'drop_tables' as never }).view).toBe('traffic');
  });
});
