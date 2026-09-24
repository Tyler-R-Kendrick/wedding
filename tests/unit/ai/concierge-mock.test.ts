import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { extractiveAnswer, NO_SOURCE } from '@/providers/ai-model/concierge-mock';

const prompt = (question: string, blocks: { title: string; lines: string[] }[]): LanguageModelV4Prompt => [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [...blocks.map((b, i) => `<source id="S${i + 1}" trust="TRUSTED_WEDDING" title="${b.title}">\n${b.lines.join('\n')}\n</source>`), `<question>${question}</question>`].join('\n'),
      },
    ],
  },
];

describe('the extractive stand-in model', () => {
  it('does not answer a question about one named place with a line about another', () => {
    const blocks = [{ title: 'Esmé: the dining room', lines: ['Dinner at Esmé, 2200 N Clark.'] }];
    expect(extractiveAnswer(prompt('Is the Cherry Circle Room open for dinner on the Friday before?', blocks))).toBe(NO_SOURCE);
  });

  it('still answers when the line or its title names the place asked about', () => {
    const byTitle = [{ title: 'White City Ballroom', lines: ['The ballroom seats 200 for dinner.'] }];
    expect(extractiveAnswer(prompt('Tell me about the White City Ballroom.', byTitle))).toBe('The ballroom seats 200 for dinner [S1].');
    const byLine = [{ title: 'Dining', lines: ['The Cherry Circle Room serves dinner nightly.'] }];
    expect(extractiveAnswer(prompt('Is the Cherry Circle Room open for dinner?', byLine))).toBe('The Cherry Circle Room serves dinner nightly [S1].');
  });

  it('matches on shared words as before when the question names nothing', () => {
    const blocks = [{ title: 'Esmé: the dining room', lines: ['Dinner at Esmé, 2200 N Clark.'] }];
    expect(extractiveAnswer(prompt('Where did they have dinner?', blocks))).toBe('Dinner at Esmé, 2200 N Clark [S1].');
  });
});
