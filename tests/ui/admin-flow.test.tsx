import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, TextField } from '@/components/admin/flow/fields';

/*
 * The admin flow kit (src/components/admin/flow). These are the guarantees every console screen
 * leans on, so they are tested once, here, rather than per screen:
 *
 *   - a destructive flow changes nothing until its box is ticked (this replaced the server actions'
 *     `confirm=yes` check when the screens moved from posted forms to flows);
 *   - an unready step says why instead of sitting behind a disabled button;
 *   - a create/edit draft survives closing the sheet, and a destructive one keeps nothing;
 *   - a capability that needs a fresh session sends the admin to /step-up with the draft kept;
 *   - `result` keeps the sheet open on a Done panel; `load` fills the form when it opens.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();

beforeAll(() => {
  // jsdom has <dialog> but not its modal API.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const sentTo = (i = 0) => String(fetchMock.mock.calls[i]?.[0]);
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as { input: unknown; confirmationToken?: string };

function DeleteThing() {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id="test:delete"
      tone="danger"
      title="Delete the thing"
      trigger={{ label: 'Delete', variant: 'danger', accessibleName: 'Delete the thing' }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: 'Delete the thing?',
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>It is gone for good.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, delete the thing" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: 'Delete the thing', capability: 'admin_delete_thing', success: 'Deleted.', input: () => ({ id: 't1' }) }}
    />
  );
}

function NameThing({ result, load }: { result?: boolean; load?: () => Promise<Partial<{ name: string }> | string> }) {
  return (
    <AdminFlow<{ name: string }>
      id="test:name"
      title="Name the thing"
      trigger={{ label: 'Name it' }}
      initial={{ name: '' }}
      load={load}
      steps={[{ title: 'The name', fields: ['name'], render: (ctx) => <TextField ctx={ctx} name="name" label="Name" /> }]}
      submit={{
        label: 'Save',
        capability: 'admin_name_thing',
        success: 'Saved.',
        input: (v) => ({ name: v.name }),
        ...(result ? { result: () => <p>Shown once: abc123</p> } : {}),
      }}
    />
  );
}

describe('admin flow kit', () => {
  it('a destructive flow changes nothing until its box is ticked, and says so', async () => {
    render(<DeleteThing />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the thing' }));
    // The trigger and the sheet's red button share the name; the sheet's is the last one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete the thing' }).at(-1)!);
    expect(await screen.findByText('Tick the box to confirm.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { deleted: true } }));
    fireEvent.click(screen.getByLabelText('Yes, delete the thing'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete the thing' }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentTo()).toBe('/api/capabilities/admin_delete_thing');
    expect(sentBody().input).toEqual({ id: 't1' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // A destructive flow never leaves a draft behind.
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps a create/edit draft when the sheet is closed, and resumes it', async () => {
    const { unmount } = render(<NameThing />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half typed' } });
    fireEvent.click(screen.getByRole('button', { name: /^Close/ }));
    await waitFor(() => expect(window.sessionStorage.getItem('wedding.admin-flow:test:name')).toContain('Half typed'));
    expect(screen.getByRole('button', { name: /^Continue: name it/ })).toBeTruthy();
    unmount();

    // A reload: a fresh tree finds the draft and offers to continue it.
    render(<NameThing />);
    fireEvent.click(await screen.findByRole('button', { name: /^Continue: name it/ }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Half typed');
  });

  it('sends a stale session to /step-up with the draft kept for the way back', async () => {
    render(<NameThing />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kept' } });
    fetchMock.mockReturnValueOnce(answer({ ok: false, error: { code: 'step_up_required', message: 'Confirm it is you.' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/step-up\?next=/)));
    const draft = JSON.parse(window.sessionStorage.getItem('wedding.admin-flow:test:name') ?? '{}') as { stepUp?: boolean; values?: { name: string } };
    expect(draft).toMatchObject({ stepUp: true, values: { name: 'Kept' } });
  });

  it('puts a field error from the server beside the field', async () => {
    render(<NameThing />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fetchMock.mockReturnValueOnce(answer({ ok: false, error: { code: 'validation', message: 'Bad', details: { issues: [{ path: 'name', message: 'That name is taken.' }] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That name is taken.')).toBeTruthy();
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a Done panel for something shown only once', async () => {
    render(<NameThing result />);
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: {} }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Shown once: abc123')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Saved.' })).toBeTruthy();
  });

  it('fills an edit from `load` when the sheet opens', async () => {
    const load = vi.fn(async () => ({ name: 'From the server' }));
    render(<NameThing load={load} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    });
    expect(load).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('From the server'));
    // Loaded values are the starting point, not an edit: nothing is kept as a draft yet.
    expect(window.sessionStorage.getItem('wedding.admin-flow:test:name')).toBeNull();
  });
});
