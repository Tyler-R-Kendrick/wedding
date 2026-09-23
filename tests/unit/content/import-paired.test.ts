import { describe, expect, it } from 'vitest';
import { assignChapters, merge, normalize, parseCsv, parsePartialDate, slugify } from '../../../scripts/import-paired.mjs';
import { timelineMomentSeedSchema } from '@/content/schemas';
import seedTimeline from '@/content/seed/timeline.json';

describe('Paired import', () => {
  it('reads dates only as precisely as they were written', () => {
    expect(parsePartialDate('2022-06-04')).toBe('2022-06-04');
    expect(parsePartialDate('June 4, 2022')).toBe('2022-06-04');
    expect(parsePartialDate('4 June 2022')).toBe('2022-06-04');
    expect(parsePartialDate('6/4/2022')).toBe('2022-06-04');
    expect(parsePartialDate('June 2022')).toBe('2022-06');
    expect(parsePartialDate('2022-06')).toBe('2022-06');
    expect(parsePartialDate('2022')).toBe('2022');
    // An instant is the calendar day in Chicago, not in UTC.
    expect(parsePartialDate('2022-06-05T03:00:00Z')).toBe('2022-06-04');
    expect(parsePartialDate('2022-02-30')).toBeNull();
    expect(parsePartialDate('someday')).toBeNull();
    expect(parsePartialDate('')).toBeNull();
  });

  it('parses quoted CSV with a BOM and loose column names', () => {
    const rows = parseCsv('﻿ID,When,Milestone,Description\r\n7,2023-05-01,"Starved Rock","We said ""I love you"", finally"\r\n');
    const { stops, problems } = normalize(rows);
    expect(problems).toEqual([]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ title: 'Starved Rock', occurredOn: '2023-05-01', note: 'We said "I love you", finally', externalRef: 'paired:7' });
  });

  it('sorts by date, keeps undated stops last, and reports what it could not read', () => {
    const { stops, problems } = normalize([
      { title: 'B', date: '2023' },
      { title: 'Undated' },
      { title: 'A', date: '2022-01-02' },
      { title: 'Bad date', date: 'soon' },
      { note: 'no title' },
    ]);
    expect(stops.map((s: { title: string }) => s.title)).toEqual(['A', 'B', 'Undated', 'Bad date']);
    expect(problems).toEqual(['entry 4 "Bad date": could not read the date "soon" — imported undated', 'entry 5: no title — skipped']);
  });

  it('moves along the line only forwards, from milestones named in words', () => {
    const { stops } = normalize([
      { title: 'We met', date: '2021-01-01' },
      { title: 'Tacos', date: '2021-01-05' },
      { title: 'First date', date: '2021-02-01' },
      { title: 'Engaged!', date: '2024-01-01' },
      { title: 'Where we met, again', date: '2024-02-01' },
    ]);
    const lines = assignChapters(stops).map((s: { chapter: string }) => s.chapter);
    expect(lines).toEqual(['met', 'met', 'connection', 'engagement', 'engagement']);
    const pinned = assignChapters(stops, { tacos: 'relationship' }).map((s: { chapter: string }) => s.chapter);
    expect(pinned[1]).toBe('relationship');
  });

  it('replaces a matching stand-in, keeps its Our Adventures link, and keeps unmatched stand-ins', () => {
    const { stops } = normalize([{ id: 'x1', title: 'Starved Rock', date: '2023-05', note: 'We said I love you' }]);
    const { rows, report } = merge(seedTimeline, assignChapters(stops), { now: new Date('2026-09-22T00:00:00Z'), storySlugs: new Set(['love']) });
    const rock = rows.find((r: { slug: string }) => r.slug === 'starved-rock');
    expect(rock).toMatchObject({ externalRef: 'paired:x1', occurredOn: '2023-05', adventureSlug: 'starved-rock', sourceKey: 'paired', placeholder: false });
    expect(report.replaced).toEqual(['starved-rock']);
    expect(report.keptStandIns).toContain('museum-of-ice-cream');
    expect(rows.map((r: { order: number }) => r.order)).toEqual(rows.map((_: unknown, i: number) => i + 1));
    for (const r of rows) expect(timelineMomentSeedSchema.safeParse(r).success, r.slug).toBe(true);
  });

  it('never gives a stop the anchor of a story chapter', () => {
    const { stops } = normalize([{ title: 'Love', date: '2023' }]);
    const { rows } = merge([], assignChapters(stops), { now: new Date(), storySlugs: new Set(['love']) });
    expect(rows[0]?.slug).toBe('love-2');
    expect(slugify("Michael Jordan's Steakhouse")).toBe('michael-jordans-steakhouse');
  });
});
