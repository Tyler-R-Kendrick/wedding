import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRecordFlow, MoveRecord } from '@/app/(admin)/admin/content/_components/ContentFlows';
import { contentEditor, contentMoveCalls, sourceOptions } from '@/app/(admin)/admin/content/_components/shared';
import type { EditorLists } from '@/app/(admin)/admin/content/_components/types';
import { SEED_SOURCES } from '@/db/seed/sources';

/*
 * The content editor as the 2026-09-27 admin review asked for it (blocker 4): no slug, position,
 * source id or JSON to type, a sentence for every missing answer, and a source chosen by name that
 * brings its kind and official page with it.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

/*
 * The lists a page reads for the flow (`editorLists`): the sources as `admin_list_content_sources`
 * returns the seeded registry, a few records by id, and the adventures and operational fields a
 * field names by web address name or key.
 */
const lists: EditorLists = {
  sources: sourceOptions(SEED_SOURCES.map((s) => ({ id: s.id, title: s.title, sourceType: s.sourceType, trustClass: s.trustClass, canonicalUrl: s.canonicalUrl ?? null, documentName: s.documentName ?? null, verifiedAt: s.verifiedAt, validFrom: null, validUntil: null, notes: null }))),
  refs: { recommendations: [{ value: '01J00000000000000000000R01', label: 'Coffee at Cindy’s' }, { value: '01J00000000000000000000R02', label: 'The Art Institute' }] },
  picks: { adventure: [{ value: 'starved-rock', label: 'Starved Rock' }], operational: [{ value: 'outlet.cindys', label: 'Cindy’s hours' }] },
};

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as { input: { table: string; data: Record<string, unknown> } };
const next = async () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })));

describe('content record flow', () => {
  it('asks for no ids, says what is missing in sentences, and derives the rest', async () => {
    render(<ContentRecordFlow editor={contentEditor('faq_entries', lists)} label="Add a question" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));

    expect(screen.queryByLabelText(/^Slug/)).toBeNull();
    expect(screen.queryByLabelText(/^Order/)).toBeNull();
    expect(screen.queryByLabelText(/Position/)).toBeNull();
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);

    await next();
    expect(screen.getByText('Choose the topic this question is about.')).toBeTruthy();
    expect(screen.getByText('Write the question as a guest would ask it.')).toBeTruthy();
    expect(screen.getByText('Write the answer.')).toBeTruthy();
    expect(screen.queryByText('Required.')).toBeNull();

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'parking' } });
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Is there valet parking?' } });
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'Yes, at the Michigan Avenue entrance.' } });
    expect(screen.getByText(/Left empty, it becomes “is-there-valet-parking”/)).toBeTruthy();
    await next();

    // The source is chosen by name; the official website brings its kind and its page.
    const source = screen.getByLabelText('Where this comes from') as HTMLSelectElement;
    expect(source.selectedOptions[0]?.textContent).toMatch(/brief/);
    fireEvent.change(source, { target: { value: '01SEED00000000000000000103' } });
    expect((screen.getByLabelText(/^Official page/) as HTMLInputElement).value).toBe('https://www.chicagoathletichotel.com/');
    expect((screen.getByLabelText('Who can see it') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Private draft: only admins');
    await next();

    expect(screen.getByText('Is there valet parking?')).toBeTruthy();
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { id: '01J0000000000000000000000A', contentVersion: 1, created: true } }));
    // The trigger and the last step's button share the name; the sheet's comes second.
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Add a question' }).at(-1)!));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { data } = sentBody().input;
    expect(data).toMatchObject({ slug: null, order: null, question: 'Is there valet parking?', sourceId: '01SEED00000000000000000103', sourceType: 'official-web', trustClass: 'EXTERNAL_DATA', sourceUrl: 'https://www.chicagoathletichotel.com/' });
  });

  it('edits a list as lines and ticks the placeholder box for text that still says TODO', async () => {
    render(<ContentRecordFlow editor={contentEditor('story_sections', lists)} label="Add a story section" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a story section' }));
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: 'met' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'How we met' } });
    fireEvent.change(screen.getByLabelText('Paragraphs'), { target: { value: 'First paragraph.\n\nTODO(Tyler & Sara): the second one.' } });
    // Photos are rows, not a JSON array.
    fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Us' } });
    await next();
    expect(screen.getByText('Photo 1: the alt text needs at least 3 characters.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'The two of us at the lake' } });
    await next();
    expect((screen.getByLabelText('This is still a placeholder') as HTMLInputElement).checked).toBe(true);
    await next();
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { id: '01J0000000000000000000000B', contentVersion: 1, created: true } }));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Add a story section' }).at(-1)!));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().input.data).toMatchObject({ paragraphs: ['First paragraph.', 'TODO(Tyler & Sara): the second one.'], media: [{ alt: 'The two of us at the lake' }], placeholder: true, slug: null, order: null });
  });

  it('offers the adventure a timeline stop opens by title, and saves its web address name', async () => {
    render(<ContentRecordFlow editor={contentEditor('timeline_moments', lists)} label="Add a timeline stop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a timeline stop' }));
    const adventure = screen.getByLabelText(/^Adventure it opens/) as HTMLSelectElement;
    expect(adventure.tagName).toBe('SELECT');
    expect([...adventure.options].map((o) => o.textContent)).toEqual(['None', 'Starved Rock']);
    fireEvent.change(adventure, { target: { value: 'starved-rock' } });
    fireEvent.change(screen.getByLabelText('Line'), { target: { value: 'met' } });
    fireEvent.change(screen.getByLabelText('Station name'), { target: { value: 'Starved Rock' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'The first long walk.' } });
    await next();
    await next();
    expect(screen.getAllByText('Starved Rock').length).toBeGreaterThan(0);
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { id: '01J0000000000000000000000C', contentVersion: 1, created: true } }));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Add a timeline stop' }).at(-1)!));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().input.data).toMatchObject({ adventureSlug: 'starved-rock' });
  });

  it('offers the operational detail a recommendation shows by name, keeping one no longer listed', async () => {
    fetchMock.mockReturnValueOnce(
      answer({ ok: true, data: { table: 'recommendations', id: '01J00000000000000000000R01', values: { title: 'Coffee at Cindy’s', category: 'food-drink', what: 'Coffee upstairs.', operationalKey: 'outlet.gone', sourceId: '01SEED00000000000000000101', sourceType: 'authored', verifiedAt: '2026-09-05T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING', visibility: 'public', placeholder: false }, contentVersion: 1, editedBy: 'seed:x', updatedAt: '2026-09-05T00:00:00.000Z', freshness: 'fresh', revisions: [] } }),
    );
    render(<ContentRecordFlow editor={contentEditor('recommendations', lists)} record={{ id: '01J00000000000000000000R01', title: 'Coffee at Cindy’s' }} label="Edit" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Edit Coffee at Cindy’s' })));
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy());
    await next();
    const operational = screen.getByLabelText(/^Live hours or menu/) as HTMLSelectElement;
    expect(operational.tagName).toBe('SELECT');
    expect([...operational.options].map((o) => o.textContent)).toEqual(['None', 'Cindy’s hours', 'outlet.gone (not listed)']);
    expect(operational.value).toBe('outlet.gone');
    fireEvent.change(operational, { target: { value: 'outlet.cindys' } });
    expect(operational.value).toBe('outlet.cindys');
  });

  it('ticks related recommendations with the kit’s checkbox group', async () => {
    render(<ContentRecordFlow editor={contentEditor('adventure_memories', lists)} label="Add an adventure" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add an adventure' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Starved Rock' } });
    await next();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Canyons and a waterfall.' } });
    const group = screen.getByRole('group', { name: 'Related recommendations (optional)' });
    expect(group).toBeTruthy();
    fireEvent.click(screen.getByLabelText('The Art Institute'));
    expect((screen.getByLabelText('The Art Institute') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Coffee at Cindy’s') as HTMLInputElement).checked).toBe(false);
    await next();
    await next();
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { id: '01J0000000000000000000000D', contentVersion: 1, created: true } }));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Add an adventure' }).at(-1)!));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody().input.data).toMatchObject({ relatedRecommendationIds: ['01J00000000000000000000R02'] });
  });
});

describe('moving a record', () => {
  it('sends the saves the table page built for Up, then refreshes', async () => {
    fetchMock.mockImplementation(() => answer({ ok: true, data: { id: 'x', contentVersion: 2, created: false } }));
    const calls = [
      { capability: 'save_content_record', input: { table: 'faq_entries', id: 'A', data: { order: 3 }, merge: true } },
      { capability: 'save_content_record', input: { table: 'faq_entries', id: 'B', data: { order: 4 }, merge: true } },
    ];
    render(<MoveRecord title="Parking" direction="up" calls={calls} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Move Parking up' })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/save_content_record');
    expect(sentBody(0).input).toEqual(calls[0]!.input);
    expect(sentBody(1).input).toEqual(calls[1]!.input);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('builds a move from the list: only the position, and records with no place yet go after the rest', () => {
    const rows = [{ id: 'A', position: 1 }, { id: 'B', position: 2 }, { id: 'C', position: null }, { id: 'D' }];
    /** The order after the saves, and that every save sends only a position. */
    const orderAfter = (i: number, d: 'up' | 'down') => {
      const pos = new Map<string, number>([['A', 1], ['B', 2], ['C', 3], ['D', 4]]);
      for (const c of contentMoveCalls('faq_entries', rows, i, d)) {
        const input = c.input as { table: string; id: string; data: Record<string, unknown>; merge: boolean };
        expect(c.capability).toBe('save_content_record');
        expect(input).toMatchObject({ table: 'faq_entries', merge: true });
        expect(Object.keys(input.data)).toEqual(['order']);
        pos.set(input.id, input.data.order as number);
      }
      expect(new Set(pos.values()).size).toBe(4);
      return [...pos.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).join('');
    };
    expect(orderAfter(1, 'up')).toBe('BACD');
    expect(orderAfter(3, 'up')).toBe('ABDC');
    expect(orderAfter(2, 'down')).toBe('ABDC');
    // B moves up without touching the records above it that stay put.
    expect(contentMoveCalls('faq_entries', rows, 1, 'up').map((c) => (c.input as { id: string }).id)).not.toContain('B');
    expect(contentMoveCalls('faq_entries', rows, 0, 'up')).toEqual([]);
  });

  it('keeps the top record’s Up inert', () => {
    render(<MoveRecord title="Parking" direction="up" calls={[]} />);
    expect(screen.getByRole('button', { name: 'Move Parking up' }).getAttribute('aria-disabled')).toBe('true');
  });
});
