import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '@/capabilities/media';
import { ModerationQueue, type QueueResponse } from '@/components/media/ModerationQueue';

/*
 * The moderation queue on /admin/media. The e2e journey (media-upload.spec.ts, "admin approves in
 * bulk…") drives it through `queue-item` rows, a "Select all" box, an "Approve and publish" button
 * and a `.media-note[role=status]` result; this pins that contract without a server, and pins the
 * rule the flow kit brought: approving is one click, rejecting confirms first and says how many.
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as { input: Record<string, unknown> };

const item = (id: string, name: string): QueueItem =>
  ({
    id,
    kind: 'image',
    source: 'guest',
    width: 4000,
    height: 3000,
    thumb: null,
    gallery: null,
    caption: null,
    altText: null,
    credit: null,
    durationSeconds: null,
    status: 'private',
    collection: { slug: 'guest-uploads', title: 'Guest uploads' },
    uploader: { kind: 'guest', guestId: 'g1' },
    originalFilename: name,
    contentType: 'image/jpeg',
    bytes: 2_000_000,
    sha256Short: 'abc',
    capturedAt: null,
    camera: null,
    hadLocation: true,
    qualitySignals: null,
    duplicateOfAssetId: null,
    reportCount: 0,
    processingError: null,
    allowDownload: false,
    allowAiProcessing: false,
    rights: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  }) as QueueItem;

const initial: QueueResponse = { items: [item('a1', 'one.jpg'), item('a2', 'two.jpg')], collections: [] };

describe('moderation queue', () => {
  it('approves the selected items in one click and says how many', async () => {
    fetchMock
      .mockReturnValueOnce(answer({ ok: true, data: { results: [{ assetId: 'a1', ok: true }, { assetId: 'a2', ok: true }] } }))
      .mockReturnValueOnce(answer({ ok: true, data: { items: [], collections: [] } }));
    const { container } = render(<ModerationQueue initial={initial} filters={{ status: 'private' }} />);
    expect(screen.getAllByTestId('queue-item')).toHaveLength(2);
    expect(screen.getAllByText(/location removed/)).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Select all'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(container.querySelector('.media-note[role="status"]')?.textContent).toContain('Approve and publish: 2 done'));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('admin_moderate_media');
    expect(bodyOf(0).input).toMatchObject({ assetIds: ['a1', 'a2'], action: 'approve' });
    await waitFor(() => expect(screen.queryAllByTestId('queue-item')).toHaveLength(0));
  });

  it('with nothing selected, every bulk action is unavailable the same way and says why', () => {
    render(<ModerationQueue initial={initial} filters={{ status: 'private' }} />);
    const hint = screen.getByText('Select items to act on them.');
    const bar = screen.getByRole('group', { name: 'Act on the selected items' });
    const actions = within(bar).getAllByRole('button');
    expect(actions.map((b) => b.textContent)).toEqual(expect.arrayContaining(['Approve and publish', 'Reject', 'Delete']));
    for (const b of actions) {
      expect(b.getAttribute('aria-disabled'), b.textContent ?? '').toBe('true');
      expect(b.getAttribute('aria-describedby')).toBe(hint.id);
    }
    // Reject and Delete are not a danger sheet about nothing.
    fireEvent.click(within(bar).getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Approve and publish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Select one.jpg'));
    expect(screen.queryByText('Select items to act on them.')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Approve and publish' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Reject the 1 item selected' })).toBeTruthy();
  });

  it('does not reject anything until the count is read and confirmed', async () => {
    render(<ModerationQueue initial={initial} filters={{ status: 'private' }} />);
    fireEvent.click(screen.getByLabelText('Select one.jpg'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject the 1 item selected' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Reject 1 item?' })).toBeTruthy();
    expect(within(sheet).getByText('one.jpg')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reject 1 item' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(sheet).getByText('Tick the box to confirm.')).toBeTruthy();

    fetchMock
      .mockReturnValueOnce(answer({ ok: true, data: { results: [{ assetId: 'a1', ok: true }] } }))
      .mockReturnValueOnce(answer({ ok: true, data: { items: [item('a2', 'two.jpg')], collections: [] } }));
    fireEvent.change(within(sheet).getByLabelText(/Why/), { target: { value: 'blurry' } });
    fireEvent.click(within(sheet).getByLabelText('Yes, reject this item'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reject 1 item' }));
    await waitFor(() => expect(bodyOf(0).input).toMatchObject({ assetIds: ['a1'], action: 'reject', reason: 'blurry' }));
    await waitFor(() => expect(screen.getAllByTestId('queue-item')).toHaveLength(1));
  });

  it('offers only the actions that apply to the state on show', () => {
    render(<ModerationQueue initial={{ items: [], collections: [] }} filters={{ status: 'rejected' }} />);
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore to the queue' })).toBeTruthy();
    expect(screen.getByText(/Nothing\s+is rejected/)).toBeTruthy();
  });
});
