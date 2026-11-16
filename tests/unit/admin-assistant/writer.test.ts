import { describe, expect, it } from 'vitest';
import { acceptSaid, choosePrompt, parseChoice, sayPrompt } from '@/domain/admin-assistant';

const answer = { facts: ['Sessions: 41', 'Pages opened: 153', 'Window: the last 7 days'], summary: '41 sessions and 153 pages opened in the last 7 days.' };

describe('what the browser’s model may do for the console', () => {
  it('chooses a view from the list, and only from the list', () => {
    expect(parseChoice('VIEW: traffic | window=24')).toEqual({ view: 'traffic', window: 24 });
    expect(parseChoice('Sure!\n**VIEW:** guest | subject=Ada Testhouse')).toEqual({ view: 'guest', subject: 'Ada Testhouse' });
    expect(parseChoice('VIEW: errors | window=9000')).toEqual({ view: 'errors' });
    expect(parseChoice('VIEW: delete_everything')).toBeNull();
    expect(parseChoice('I think you want the traffic view')).toBeNull();
    expect(parseChoice(null)).toBeNull();
  });

  it('is shown the views and the question, never a record', () => {
    const { system, prompt } = choosePrompt('did many people look at the hotel page');
    expect(system).toContain('traffic:');
    expect(prompt).toBe('Question: did many people look at the hotel page');
  });

  it('keeps a sentence only when every figure in it is a figure it was given', () => {
    expect(acceptSaid('You had 41 sessions this week, with 153 pages opened.', answer)).toBe('You had 41 sessions this week, with 153 pages opened.');
    // A number that is not in the facts: the composer’s sentence stays.
    expect(acceptSaid('You had 42 sessions this week.', answer)).toBeNull();
    expect(acceptSaid('Traffic is up 20% on last week!', answer)).toBeNull();
    // A refusal, an essay, or nothing at all.
    expect(acceptSaid('As an AI language model I cannot see your site.', answer)).toBeNull();
    expect(acceptSaid('x'.repeat(400), answer)).toBeNull();
    expect(acceptSaid('', answer)).toBeNull();
  });

  it('strips markup and exclamation marks from what it keeps', () => {
    expect(acceptSaid('**41 sessions** in the last 7 days!', answer)).toBe('41 sessions in the last 7 days.');
  });

  it('hands the model the facts and the draft, capped', () => {
    const { prompt } = sayPrompt('how many visits', answer);
    expect(prompt).toContain('- Sessions: 41');
    expect(prompt).toContain('Our draft: 41 sessions');
  });
});
