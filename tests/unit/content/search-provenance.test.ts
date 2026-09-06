import { describe, expect, it } from 'vitest';
import type { KnowledgeRecordRow } from '@/db/schema/knowledge';
import { dedupeCitations, publicUrlFor, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import { buildKnowledgeRecords, toTerms } from '@/domain/knowledge/projection';
import { rankRecords, scoreRecord, snippetFor } from '@/domain/knowledge/search';

const now = new Date('2026-09-05T12:00:00Z');
const base = {
  sourceId: 'src', sourceUrl: null, verifiedAt: new Date('2026-09-04T00:00:00Z'), validFrom: null, validUntil: null,
  trustClass: 'TRUSTED_WEDDING' as const, contentVersion: 1, editedBy: 'seed:test',
};

describe('provenance projections', () => {
  it('cites official pages for external data and internal routes for authored copy, never repo paths', () => {
    expect(publicUrlFor({ sourceType: 'official-web', sourceUrl: 'https://www.chicagoathletichotel.com/about/faq/' }, '/explore-caa#getting-here')).toBe('https://www.chicagoathletichotel.com/about/faq/');
    expect(publicUrlFor({ sourceType: 'authored', sourceUrl: 'https://example.com' }, '/our-story#love')).toBe('/our-story#love');
    expect(publicUrlFor({ sourceType: 'official-web', sourceUrl: '/docs/design/brief.md' }, '/explore-caa')).toBe('/explore-caa');
    const c = toRecordCitation({ ...base, sourceType: 'authored' }, { route: '/our-story#love', title: 'Love', recordRef: { type: 'story_sections', id: '1' }, now });
    expect(c.url).toBe('/our-story#love');
    expect(c.url).not.toMatch(/^\/docs\//);
  });

  it('computes freshness and labels external data', () => {
    const v = toProvenanceView({ ...base, sourceType: 'official-web', sourceUrl: 'https://www.chicagoathletichotel.com/', trustClass: 'EXTERNAL_DATA' }, { route: '/explore-caa', now, sources: new Map([['src', 'chicagoathletichotel.com']]) });
    expect(v).toMatchObject({ sourceTitle: 'chicagoathletichotel.com', freshness: 'fresh', policy: 'operational', external: true, url: 'https://www.chicagoathletichotel.com/' });
  });

  it('dedupes citations by source, url and record', () => {
    const c = { sourceId: 's' as never, title: 't', url: '/x', recordRef: { type: 'a', id: '1' } };
    expect(dedupeCitations([c, { ...c }, { ...c, recordRef: { type: 'a', id: '2' } }])).toHaveLength(2);
  });
});

describe('knowledge projection + static search', () => {
  const rows = {
    story_sections: [{ ...base, sourceType: 'authored' as const, id: 's1', slug: 'love', chapter: 'love' as const, order: 1, title: 'Love', paragraphs: ['We said "I love you" at Starved Rock.', 'TODO(Tyler & Sara): the trail.'], media: [], visibility: 'public' as const, placeholder: true, createdAt: now, updatedAt: now }],
    places: [],
    adventure_memories: [],
    recommendations: [],
    itinerary_templates: [],
    venue_spaces: [],
    venue_facts: [],
    operational_fields: [{ ...base, sourceType: 'official-web' as const, sourceUrl: 'https://www.chicagoathletichotel.com/about/faq/', trustClass: 'EXTERNAL_DATA' as const, id: 'o1', key: 'valet.entrance', kind: 'valet' as const, label: 'Valet entrance', value: '71 E Madison', url: 'https://www.chicagoathletichotel.com/about/faq/', note: null, order: 1, visibility: 'public' as const, placeholder: false, createdAt: now, updatedAt: now }],
    faq_entries: [{ ...base, sourceType: 'authored' as const, id: 'f1', slug: 'dress', order: 1, category: 'dress' as const, question: 'What should I wear?', answer: 'TODO(Tyler & Sara): dress code.', route: null, visibility: 'public' as const, placeholder: true, createdAt: now, updatedAt: now }],
  };

  it('drops placeholder sentences and skips records with nothing left', () => {
    const records = buildKnowledgeRecords(rows, now);
    expect(records.map((r) => r.id).sort()).toEqual(['operational_fields:o1', 'story_sections:s1']);
    const story = records.find((r) => r.id === 'story_sections:s1')!;
    expect(story.content).not.toContain('TODO');
    expect(story.route).toBe('/our-story#love');
    expect(story.terms).toContain('starved');
    expect(toTerms('Midōsuji Café')).toEqual(['midosuji', 'cafe']);
  });

  it('scores title hits above content hits and returns caveats for aging records', () => {
    const records = buildKnowledgeRecords(rows, now) as KnowledgeRecordRow[];
    const valet = records.find((r) => r.id === 'operational_fields:o1')!;
    expect(scoreRecord(valet, 'valet')).toBe(3);
    expect(scoreRecord(valet, 'madison')).toBeGreaterThanOrEqual(1);
    expect(scoreRecord(valet, 'zzz')).toBe(0);
    const ranked = rankRecords(records, 'valet entrance', now, 5);
    expect(ranked[0]!.route).toBe('/explore-caa#getting-here');
    expect(ranked[0]!.caveat).toBeUndefined();
    const later = rankRecords(records, 'valet', new Date('2026-11-01T00:00:00Z'), 5);
    expect(later[0]!.freshness).toBe('aging');
    expect(later[0]!.caveat).toContain('confirm with https://www.chicagoathletichotel.com/about/faq/');
    expect(snippetFor('a'.repeat(300) + ' valet here', 'valet')).toContain('valet');
  });
});
