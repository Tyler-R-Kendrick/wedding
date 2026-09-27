import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRecordFlow } from '@/app/(admin)/admin/content/_components/ContentFlows';
import { contentEditor } from '@/app/(admin)/admin/content/_components/shared';

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

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as { input: { table: string; data: Record<string, unknown> } };
const next = async () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })));

describe('content record flow', () => {
  it('asks for no ids, says what is missing in sentences, and derives the rest', async () => {
    render(<ContentRecordFlow editor={contentEditor('faq_entries')} label="Add a question" />);
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
    render(<ContentRecordFlow editor={contentEditor('story_sections')} label="Add a story section" />);
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
});
