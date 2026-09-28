import { describe, expect, it } from 'vitest';
import { capitalise, errorWords, humanise, intentWords, kindWords, outcomeWords, reasonWords, ruleWords, selectedByWords, whereWords } from '@/app/(admin)/admin/concierge/words';

/*
 * /admin/concierge shows the concierge's log in words (the 2026-09-27 admin review): the stored
 * codes stay in the trace, and a code with no words yet reads as itself, humanised, never raw.
 */
describe('the concierge log in words', () => {
  it('says why a sentence was dropped and which rule an injection matched', () => {
    expect(reasonWords(['uncited', 'untrusted-only'])).toBe('it cited no source; its only sources were not trusted');
    // The audit trail stores them comma-separated.
    expect(reasonWords('unsupported,off-topic')).toBe('its source did not say it; its source was about something else');
    expect(capitalise(ruleWords('ignore-instructions,exfiltration'))).toBe('Told it to ignore its instructions; asked for secrets or its instructions');
    expect(whereWords('user_message')).toBe('In the question');
    expect(whereWords(undefined)).toBe('In a source it read');
  });

  it('names intents, outcomes, kinds and error codes', () => {
    expect(intentWords('venue.history')).toBe('The venue’s history');
    expect(intentWords('wedding.protected:room')).toBe('Which room (not decided yet)');
    expect(outcomeWords('confirmation_required')).toBe('Needs the guest to confirm');
    expect(kindWords('navigate')).toBe('Link to a page');
    expect(selectedByWords('router')).toBe('The router');
    expect(errorWords('step_up_required')).toBe('Needed a fresh sign-in');
    expect(errorWords(null)).toBe('');
  });

  it('humanises a code it has no words for rather than showing it raw', () => {
    expect(humanise('model-rejected')).toBe('Model rejected');
    expect(reasonWords(['brand-new-verdict'])).toBe('brand new verdict');
    expect(intentWords('wedding.protected:dress')).toBe('Wedding protected dress');
    expect(outcomeWords('timed_out')).toBe('Timed out');
    expect(ruleWords('')).toBe('');
  });
});
