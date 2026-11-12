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

  // What a guest weighs before going to a recommended place (the fields after Cost and Accessibility).
  const recommendation = {
    slug: 'cindys', title: 'Cindy’s Rooftop', category: 'food-drink', interests: ['food'], placeId: null, what: 'Dinner over the park.', durationMinutes: 90, distanceFromCaa: null,
    cost: null, accessibility: null, bookingUrl: null, experienceId: null, whyWeShareThis: null, kidFriendly: null, draft: false, operationalKey: null,
    priceLevel: 3, hours: 'Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off', hoursNote: 'Shorter hours in winter.', reservations: 'recommended', diets: ['vegetarian', 'gluten-free'],
    stepFree: true, setting: 'both', minAge: 21, factSources: ['https://www.example.com/hours'], factsCheckedAt: '2026-11-10',
    sourceId: '01SEED00000000000000000101', sourceType: 'authored', sourceUrl: null, verifiedAt: '2026-09-04T00:00:00.000Z', validFrom: null, validUntil: null,
    trustClass: 'TRUSTED_WEDDING', visibility: 'public', placeholder: false,
  };
  const unknown = { priceLevel: null, hours: null, hoursNote: null, reservations: null, diets: [], stepFree: null, setting: null, minAge: null, factSources: [], factsCheckedAt: null };
  const issuesOf = (data: Record<string, unknown>) => {
    const r = parseEditable('recommendations', data);
    return r.ok ? [] : ((r.error.details?.issues ?? []) as { path: string; message: string }[]);
  };

  it('asks for a place’s facts right after cost and accessibility, in plain words', () => {
    const fields = TABLE_SPECS.recommendations.fields;
    const names = fields.map((f) => f.name);
    const at = names.indexOf('accessibility');
    expect(names.indexOf('cost')).toBe(at - 1);
    expect(names.slice(at + 1, at + 11)).toEqual(['priceLevel', 'hours', 'hoursNote', 'reservations', 'diets', 'stepFree', 'setting', 'minAge', 'factSources', 'factsCheckedAt']);
    const field = (name: string) => fields.find((f) => f.name === name)!;
    expect(field('priceLevel')).toMatchObject({ label: 'Price', type: 'select', numeric: true, options: ['1', '2', '3', '4'], optionLabels: { 1: '$ (under $15 each)', 2: '$$ ($15 to $40)', 3: '$$$ ($40 to $100)', 4: '$$$$ (over $100)' } });
    expect(field('hours').label).toBe('Opening hours');
    expect(field('hours').help).toContain('Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off');
    expect(field('reservations')).toMatchObject({ label: 'Booking', optionLabels: { required: 'Book ahead (required)', recommended: 'Booking a good idea', 'walk-in': 'Just walk in', tickets: 'Timed tickets' } });
    expect(field('diets')).toMatchObject({ label: 'Menu marks options for', editor: 'choices', options: ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'] });
    expect(field('stepFree')).toMatchObject({ label: 'Step-free way in', type: 'tristate' });
    expect(field('setting')).toMatchObject({ label: 'Indoors or outdoors', optionLabels: { indoors: 'Indoors', outdoors: 'Outdoors', both: 'Both' } });
    expect(field('minAge')).toMatchObject({ label: 'Youngest age let in', type: 'number', min: 1, max: 21 });
    expect(field('factSources')).toMatchObject({ label: 'Where these facts were checked', editor: 'lines' });
    expect(field('factsCheckedAt')).toMatchObject({ label: 'Facts last checked', type: 'date' });
    // None is required, none is hidden under Technical details, they are asked together on one step,
    // and every one says what it is in words.
    expect(fields.filter((f) => f.step).map((f) => f.name)).toEqual(names.slice(at + 1, at + 11));
    for (const name of names.slice(at + 1, at + 11)) {
      expect(field(name).required, name).toBeFalsy();
      expect(field(name).technical, name).toBeFalsy();
      expect(field(name).step?.title, name).toBe('Good to know before going');
      for (const label of Object.values(field(name).optionLabels ?? {})) expect(label, name).not.toMatch(/[—–]/);
    }
  });

  it('accepts a recommendation’s facts, and the same record with none of them known', () => {
    const full = parseEditable('recommendations', recommendation);
    expect(full.ok && full.value).toMatchObject({ priceLevel: 3, hours: recommendation.hours, reservations: 'recommended', diets: ['vegetarian', 'gluten-free'], stepFree: true, setting: 'both', minAge: 21, factSources: recommendation.factSources, factsCheckedAt: '2026-11-10' });
    expect(parseEditable('recommendations', { ...recommendation, ...unknown }).ok).toBe(true);
    expect(parseEditable('recommendations', { ...recommendation, stepFree: false, hours: '24/7' }).ok).toBe(true);
  });

  it('turns back facts the site could not read to guests, saying how to write them', () => {
    expect(issuesOf({ ...recommendation, hours: 'Weekdays 7 to 6' })).toEqual([{ path: 'hours', message: 'Write the hours like this: Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off' }]);
    expect(issuesOf({ ...recommendation, hours: 'Mo 25:00-26:00' }).map((i) => i.path)).toEqual(['hours']);
    for (const priceLevel of [0, 5, 2.5, '2']) expect(issuesOf({ ...recommendation, priceLevel }).map((i) => i.path), String(priceLevel)).toEqual(['priceLevel']);
    expect(issuesOf({ ...recommendation, minAge: 22 })).toEqual([{ path: 'minAge', message: 'Enter a whole number from 1 to 21.' }]);
    expect(issuesOf({ ...recommendation, minAge: 0 })).toEqual([{ path: 'minAge', message: 'Enter a whole number from 1 to 21.' }]);
    expect(issuesOf({ ...recommendation, reservations: 'maybe' }).map((i) => i.path)).toEqual(['reservations']);
    expect(issuesOf({ ...recommendation, setting: 'rooftop' }).map((i) => i.path)).toEqual(['setting']);
    expect(issuesOf({ ...recommendation, diets: ['vegetarian', 'paleo'] }).map((i) => i.path)).toEqual(['diets.1']);
    expect(issuesOf({ ...recommendation, factSources: ['http://www.example.com/hours'] })).toEqual([{ path: 'factSources.0', message: 'Enter the whole address of each page, starting with https://.' }]);
    expect(issuesOf({ ...recommendation, factsCheckedAt: 'last Tuesday' }).map((i) => i.path)).toEqual(['factsCheckedAt']);
  });

  it('round-trips a recommendation’s facts through form values, the price as a number', () => {
    const form = toFormValues('recommendations', { ...recommendation, verifiedAt: new Date(recommendation.verifiedAt) });
    expect(form).toMatchObject({ priceLevel: '3', hours: recommendation.hours, reservations: 'recommended', stepFree: 'yes', setting: 'both', minAge: '21', factsCheckedAt: '2026-11-10' });
    expect(JSON.parse(form.diets!)).toEqual(['vegetarian', 'gluten-free']);
    const back = coerceFormValues('recommendations', form);
    expect(back.ok && back.value).toMatchObject({ priceLevel: 3, minAge: 21, stepFree: true, diets: ['vegetarian', 'gluten-free'], factSources: recommendation.factSources });
    const parsed = back.ok ? parseEditable('recommendations', back.value) : back;
    expect(parsed.ok && parsed.value).toEqual(recommendation);

    // Nothing known: every fact comes back empty, and "No" is not the same as "Not known".
    const empty = toFormValues('recommendations', { ...recommendation, ...unknown, verifiedAt: new Date(recommendation.verifiedAt) });
    expect(empty).toMatchObject({ priceLevel: '', hours: '', reservations: '', stepFree: '', setting: '', minAge: '', factsCheckedAt: '' });
    const none = coerceFormValues('recommendations', empty);
    expect(none.ok && none.value).toMatchObject({ priceLevel: null, hours: null, reservations: null, stepFree: null, setting: null, minAge: null, diets: [], factSources: [], factsCheckedAt: null });
    expect(coerceFormValues('recommendations', { ...form, stepFree: 'no' })).toMatchObject({ ok: true, value: { stepFree: false } });
    const bad = coerceFormValues('recommendations', { ...form, priceLevel: 'cheap' });
    expect(!bad.ok && bad.error.details?.issues).toEqual([{ path: 'priceLevel', message: 'must be one of the choices' }]);
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
