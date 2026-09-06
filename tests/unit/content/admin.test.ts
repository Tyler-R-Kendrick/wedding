import { describe, expect, it } from 'vitest';
import { coerceFormValues, editableSchema, parseEditable, TABLE_SPECS, toFormValues } from '@/domain/content/admin';

const story = {
  slug: 'how-we-met', chapter: 'met', order: 1, title: 'How we met', paragraphs: ['We met at Allison and Jamie\'s wedding.'], media: [],
  sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-09-04T00:00:00.000Z', validFrom: null, validUntil: null,
  trustClass: 'TRUSTED_WEDDING', visibility: 'public', placeholder: false,
};

describe('admin editing specs', () => {
  it('every table spec carries the provenance fields', () => {
    for (const spec of Object.values(TABLE_SPECS)) {
      const names = spec.fields.map((f) => f.name);
      for (const p of ['sourceId', 'sourceType', 'sourceUrl', 'verifiedAt', 'validFrom', 'validUntil', 'trustClass', 'visibility', 'placeholder']) expect(names, spec.label).toContain(p);
      expect(names).toContain(spec.titleField);
    }
    expect(editableSchema('story_sections').safeParse(story).success).toBe(true);
  });

  it('rejects placeholder text unless the placeholder flag is on', () => {
    const r = parseEditable('story_sections', { ...story, paragraphs: ['TODO(Tyler & Sara): proposal'] });
    expect(!r.ok && r.error.code).toBe('validation');
    expect(!r.ok && JSON.stringify(r.error.details)).toContain('placeholder');
    expect(parseEditable('story_sections', { ...story, paragraphs: ['TODO(Tyler & Sara): proposal'], placeholder: true }).ok).toBe(true);
  });

  it('requires an official page for official-web records and a sane validity window', () => {
    const noUrl = parseEditable('operational_fields', { key: 'outlet.x', kind: 'outlet', label: 'X', value: null, url: null, note: null, order: 1, sourceId: 's', sourceType: 'official-web', sourceUrl: null, verifiedAt: '2026-09-05T00:00:00.000Z', validFrom: null, validUntil: null, trustClass: 'EXTERNAL_DATA', visibility: 'public', placeholder: false });
    expect(!noUrl.ok && noUrl.error.details?.issues).toEqual([{ path: 'sourceUrl', message: 'required for official-web' }]);
    const window = parseEditable('story_sections', { ...story, validFrom: '2026-09-10T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z' });
    expect(!window.ok && window.error.details?.issues).toEqual([{ path: 'validUntil', message: 'before validFrom' }]);
    expect(parseEditable('story_sections', { ...story, extra: 1 }).ok).toBe(false); // strict
  });

  it('coerces form strings into typed values and reports bad JSON', () => {
    const ok = coerceFormValues('recommendations', { slug: 'x', title: 'X', category: 'food-drink', interests: '["food"]', what: 'w', durationMinutes: '45', kidFriendly: 'yes', draft: 'on', sourceId: 's', sourceType: 'authored', verifiedAt: '2026-09-05T10:00', trustClass: 'TRUSTED_WEDDING', visibility: 'public' });
    expect(ok.ok && ok.value).toMatchObject({ interests: ['food'], durationMinutes: 45, kidFriendly: true, draft: true, placeholder: false, cost: null, verifiedAt: expect.stringMatching(/Z$/) });
    const bad = coerceFormValues('recommendations', { interests: '[not json' });
    expect(!bad.ok && bad.error.details?.issues).toEqual([{ path: 'interests', message: 'must be valid JSON' }]);
  });

  it('round-trips a row through form values', () => {
    const row = { ...story, verifiedAt: new Date(story.verifiedAt), paragraphs: ['a'], placeholder: true };
    const form = toFormValues('story_sections', row);
    expect(form.paragraphs).toBe('[\n  "a"\n]');
    expect(form.placeholder).toBe('on');
    expect(form.verifiedAt).toBe('2026-09-04T00:00:00.000Z');
    const back = coerceFormValues('story_sections', form);
    expect(back.ok && parseEditable('story_sections', back.value).ok).toBe(true);
  });
});
