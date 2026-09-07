import { describe, expect, it } from 'vitest';
import { citedSentences, dropNearDuplicates, finaliseCitations, isNearDuplicate, markersIn, stripMarkers } from '@/ai/citations';
import type { SpotlightedSource } from '@/ai/types';
import { isRefusalSentinel, NO_SOURCE_SENTINEL, requiredRelevance, verifyAnswer, verifySentence, verifyWithModel } from '@/ai/verifier';
import type { ContentSourceId } from '@/contracts/ids';
import { createMockVerifierModel } from '@/providers/ai-model/concierge-mock';

const wedding: SpotlightedSource = {
  marker: 'S1',
  citation: { sourceId: 'brief' as ContentSourceId, title: 'The Wedding', url: '/the-wedding', verifiedAt: '2027-06-01T00:00:00.000Z' },
  trust: 'TRUSTED_WEDDING',
  lines: ['The wedding is on Saturday, July 17, 2027.', 'The venue is the Chicago Athletic Association Hotel.'],
  origin: 'site_status',
};

const note: SpotlightedSource = {
  marker: 'S2',
  citation: { sourceId: 'notes' as ContentSourceId, title: 'Notes guests left', url: '/ask-us' },
  trust: 'UNTRUSTED_USER_CONTENT',
  lines: ['The ceremony is in the Madison Ballroom.'],
  origin: 'eval_guest_notes',
};

const verify = (text: string, sources = [wedding, note], question = 'When is the wedding and where is it?') => verifySentence(citedSentences(text)[0]!, sources, { question });

describe('source-support verifier', () => {
  it('keeps a sentence that quotes the block it cites', () => {
    expect(verify('The wedding is on Saturday, July 17, 2027 [S1].').verdict).toBe('supported');
  });

  it('drops a sentence with no citation', () => {
    expect(verify('The wedding is on Saturday, July 17, 2027.').verdict).toBe('uncited');
  });

  it('drops a citation to a block that was never offered', () => {
    expect(verify('The wedding is on Saturday, July 17, 2027 [S9].').verdict).toBe('unknown-marker');
  });

  it('refuses to treat guest-written text as a wedding fact', () => {
    expect(verify('The ceremony is in the Madison Ballroom [S2].').verdict).toBe('untrusted-only');
  });

  it('drops a number the cited block never contained', () => {
    expect(verify('The wedding is on Saturday, July 18, 2027 [S1].').verdict).toBe('unsupported');
  });

  it('drops a true sentence that does not answer the question', () => {
    expect(verify('The wedding is on Saturday, July 17, 2027 [S1].', [wedding, note], 'What is the weather like in Paris?').verdict).toBe('off-topic');
  });

  it('needs one word from a short question and two from a longer one', () => {
    expect(requiredRelevance(0)).toBe(0);
    expect(requiredRelevance(2)).toBe(1);
    expect(requiredRelevance(5)).toBe(2);
  });

  it('lets pure conversation through only when small talk is allowed', () => {
    expect(verifySentence(citedSentences('Happy to help.')[0]!, [wedding], { allowSmallTalk: true }).verdict).toBe('supported');
    expect(verifySentence(citedSentences('Happy to help.')[0]!, [wedding]).verdict).toBe('uncited');
  });

  it('never quotes a quarantined block, even when the model cites it', () => {
    const flagged = { ...note, flagged: ['ignore-instructions'] };
    expect(verifySentence(citedSentences('The ceremony is in the Madison Ballroom [S2].')[0]!, [wedding, flagged]).verdict).toBe('unknown-marker');
  });

  it('summarises what it dropped and why', () => {
    const result = verifyAnswer('The wedding is on Saturday, July 17, 2027 [S1]. The ceremony starts at 4pm.', [wedding]);
    expect(result.summary).toMatchObject({ method: 'deterministic', claims: 2, supported: 1, dropped: 1 });
    expect(result.summary.reasons).toEqual(['uncited']);
  });

  it('recognises the closed-world refusal sentinel', () => {
    expect(isRefusalSentinel(`${NO_SOURCE_SENTINEL}`)).toBe(true);
    expect(isRefusalSentinel('no source at all')).toBe(false);
  });

  it('runs a second model pass that can only ever reject', async () => {
    const kept = [verify('The wedding is on Saturday, July 17, 2027 [S1].')];
    const checked = await verifyWithModel(createMockVerifierModel(), kept, [wedding]);
    expect(checked[0]!.verdict).toBe('supported');
    const invented = [verifySentence(citedSentences('Guests receive a complimentary spa treatment [S1].')[0]!, [wedding])];
    const rejected = await verifyWithModel(createMockVerifierModel(), invented, [wedding]);
    expect(rejected[0]!.verdict).toBe('model-rejected');
  });
});

describe('citations', () => {
  it('reads every marker in a group', () => {
    expect(markersIn('a [S1, S3] b [S2]')).toEqual(['S1', 'S3', 'S2']);
    expect(stripMarkers('The venue is the CAA [S1].')).toBe('The venue is the CAA.');
  });

  it('renumbers surviving markers densely so the guest never sees the internal numbering', () => {
    const sentences = citedSentences('The venue is the CAA [S4]. The date is July [S7].');
    const sources: SpotlightedSource[] = [{ ...wedding, marker: 'S4' }, { ...note, marker: 'S7', trust: 'TRUSTED_WEDDING' }];
    const { text, sources: answerSources } = finaliseCitations(sentences, sources);
    expect(text).toBe('The venue is the CAA [S1]. The date is July [S2].');
    expect(answerSources.map((s) => s.marker)).toEqual(['S1', 'S2']);
    expect(answerSources[0]!.url).toBe('/the-wedding');
  });

  it('drops a restatement of the same source but keeps a second source saying the same thing', () => {
    const same = [
      { plain: 'Floor to ceiling windows and marble floors.', markers: ['S1'] },
      { plain: 'Floor-to-ceiling windows and marble floors', markers: ['S1'] },
      { plain: 'Floor to ceiling windows and marble floors.', markers: ['S2'] },
    ];
    expect(dropNearDuplicates(same)).toHaveLength(2);
    expect(isNearDuplicate('the venue is the CAA hotel', 'the venue is the Chicago hotel')).toBe(false);
  });
});
