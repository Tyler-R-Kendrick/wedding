import { describe, expect, it } from 'vitest';
import { WEDDING_DATE_ISO } from '@/contracts/lifecycle';
import {
  blendScore,
  buildIndexText,
  isScheduleSlot,
  lexicalOverlap,
  localParts,
  queryTerms,
  SCHEDULE_SLOT_LABELS,
  matchedQueryTerms,
  scheduleSlotFor,
  stem,
  termMatches,
  tokenize,
  venueClassFrom,
} from '@/domain/mediaai/text';

/** 2027-07-17 in America/Chicago is UTC-5, so local noon is 17:00Z. */
const chicago = (hhmm: string, day = WEDDING_DATE_ISO) => new Date(`${day}T${hhmm}:00-05:00`);

describe('schedule alignment', () => {
  it('buckets capture times by the wedding day in the wedding time zone', () => {
    expect(scheduleSlotFor(chicago('09:30'))).toBe('wedding_morning');
    expect(scheduleSlotFor(chicago('14:00'))).toBe('wedding_afternoon');
    expect(scheduleSlotFor(chicago('18:30'))).toBe('wedding_evening');
    expect(scheduleSlotFor(chicago('22:15'))).toBe('wedding_night');
    expect(scheduleSlotFor(chicago('12:00', '2027-07-16'))).toBe('before_wedding');
    expect(scheduleSlotFor(chicago('12:00', '2027-07-18'))).toBe('after_wedding');
  });

  it('never invents a slot for an unknown or invalid capture time', () => {
    expect(scheduleSlotFor(null)).toBe('unknown');
    expect(scheduleSlotFor(undefined)).toBe('unknown');
    expect(scheduleSlotFor(new Date('nope'))).toBe('unknown');
  });

  it('is time-zone aware at the day boundary (00:30 Chicago is still the wedding day)', () => {
    // 2027-07-18T05:30Z == 2027-07-18 00:30 Chicago -> the day after, not "wedding_night".
    expect(scheduleSlotFor(new Date('2027-07-18T05:30:00Z'))).toBe('after_wedding');
    // 2027-07-18T04:30Z == 2027-07-17 23:30 Chicago -> wedding night.
    expect(scheduleSlotFor(new Date('2027-07-18T04:30:00Z'))).toBe('wedding_night');
    expect(localParts(new Date('2027-07-18T04:30:00Z')).day).toBe('2027-07-17');
  });

  it('labels every slot and validates slot strings', () => {
    for (const slot of Object.keys(SCHEDULE_SLOT_LABELS)) expect(isScheduleSlot(slot)).toBe(true);
    expect(isScheduleSlot('brunch')).toBe(false);
    expect(isScheduleSlot(7)).toBe(false);
  });
});

describe('venue classification', () => {
  it('prefers a valid provider class, then a venue-like tag, then unknown', () => {
    expect(venueClassFrom('ballroom', [])).toBe('ballroom');
    expect(venueClassFrom('unknown', ['Garden', 'flowers'])).toBe('garden');
    expect(venueClassFrom(undefined, ['lake'])).toBe('lakefront');
    expect(venueClassFrom('somewhere-else', ['candid'])).toBe('unknown');
    expect(venueClassFrom(undefined, [])).toBe('unknown');
  });
});

describe('index text', () => {
  const base = {
    caption: null,
    altText: null,
    suggestedCaption: null,
    suggestedAltText: null,
    tags: [] as string[],
    collectionTitle: 'From our guests',
    chapter: null,
    kind: 'image' as const,
    source: 'guest' as const,
    venueClass: 'unknown' as const,
    scheduleSlot: 'unknown' as const,
  };

  it('puts human text first and adds only derived structural facts', () => {
    const text = buildIndexText({ ...base, caption: 'Our first dance', tags: ['dancing'], venueClass: 'ballroom', scheduleSlot: 'wedding_evening', chapter: 'first_dances' });
    expect(text.startsWith('Our first dance')).toBe(true);
    expect(text).toContain('album: From our guests');
    expect(text).toContain('chapter: first dance dancing');
    expect(text).toContain('setting: ballroom');
    expect(text).toContain('when: wedding day, evening');
    expect(text).toContain('photo');
  });

  it('omits unknown facets rather than inventing them, and credits the vendor for professional media', () => {
    const plain = buildIndexText(base);
    expect(plain).not.toContain('setting:');
    expect(plain).not.toContain('when:');
    const pro = buildIndexText({ ...base, source: 'professional', vendorName: 'Brooke Alaina Photography', kind: 'video' });
    expect(pro).toContain('professional by Brooke Alaina Photography');
    expect(pro).toContain('video clip');
  });

  it('does not repeat an identical alt-text suggestion and is length-capped', () => {
    const same = buildIndexText({ ...base, suggestedCaption: 'a toast', suggestedAltText: 'a toast' });
    expect(same.match(/a toast/g)).toHaveLength(1);
    expect(buildIndexText({ ...base, caption: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(2000);
  });
});

describe('lexical scoring', () => {
  it('drops stop words and the query framing', () => {
    expect(queryTerms('show me photos of the first dance')).toEqual(['first', 'dance']);
    expect(tokenize('A, b—cd 12')).toEqual(['cd', '12']);
  });

  it('matches prefixes so "dance" finds "dancing"', () => {
    expect(lexicalOverlap('first dance', 'dancing in the ballroom, first')).toBe(1);
    expect(lexicalOverlap('first dance', 'a bouquet on marble')).toBe(0);
    expect(lexicalOverlap('the of and', 'anything')).toBe(0);
  });

  it('blends cosine and overlap into [0, 1]', () => {
    expect(blendScore(1, 1)).toBe(1);
    expect(blendScore(-5, 0)).toBe(0);
    expect(blendScore(0.5, 1)).toBeCloseTo(0.65, 5);
  });
});

describe('stemming', () => {
  it('folds the endings that matter for search and leaves short words alone', () => {
    expect(stem('dancing')).toBe(stem('dance'));
    expect(stem('toasts')).toBe(stem('toast'));
    expect(stem('flowers')).toBe(stem('flower'));
    expect(stem('dresses')).toBe(stem('dress'));
    expect(stem('is')).toBe('is');
    expect(stem('dress')).toBe('dress');
  });

  it('does not fold unrelated words together', () => {
    expect(stem('street')).not.toBe(stem('strength'));
    expect(termMatches('ceremony', 'certain')).toBe(false);
    expect(termMatches('dance', 'dancing')).toBe(true);
    expect(termMatches('toast', 'toasts')).toBe(true);
  });

  it('reports only terms the score actually used', () => {
    expect(matchedQueryTerms('show me the first dance', 'dancing under string lights. album: From our guests')).toEqual(['dance']);
    expect(matchedQueryTerms('first dance', 'our first dance, dancing')).toEqual(['first', 'dance']);
    expect(matchedQueryTerms('flowers on the table', 'a quiet hallway')).toEqual([]);
  });
});
