import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantHostProvider, defaultHost, type AssistantHost } from '@/components/admin/assistant/openui/host';
import { AdminRenderer } from '@/components/admin/assistant/openui/library';
import { VIEW_NAMES, compose, type Intent } from '@/domain/admin-assistant';
import { AUDIT, ERRORS, EVERYTHING, JOBS, LIFECYCLE, METRICS, RSVP, SCREENS, SESSION, SESSIONS, TRAFFIC } from '../unit/admin-assistant/fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const RAW: Record<string, unknown> = {
  admin_site_traffic: TRAFFIC,
  admin_list_sessions: SESSIONS,
  admin_session_detail: SESSION,
  admin_site_errors: ERRORS,
  admin_lifecycle_status: LIFECYCLE,
  admin_jobs_overview: JOBS,
  admin_rsvp_overview: RSVP,
  admin_ops_metrics: METRICS,
  admin_search_audit: AUDIT,
};

const intent = (view: Intent['view'], extra: Partial<Intent> = {}): Intent => ({ view, confidence: 3, ...extra });

/** A composed program through the real OpenUI <Renderer>, its tools answered from the fixtures. */
async function show(program: string, call?: AssistantHost['call']) {
  const calls: { name: string; body: unknown }[] = [];
  const host: AssistantHost = {
    ...defaultHost,
    call: call ?? (async (name, body) => (calls.push({ name, body }), name in RAW ? { ok: true, data: RAW[name] } : { ok: false, error: { code: 'not_found', message: 'no such tool' } })),
  };
  const errors: unknown[][] = [];
  const onAsk = vi.fn<(message: string) => void>();
  const utils = render(
    <AssistantHostProvider host={host}>
      <AdminRenderer response={program} onAsk={onAsk} onError={(e) => errors.push(e as unknown[])} />
    </AssistantHostProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return { ...utils, calls, onAsk, problems: () => errors.flat() };
}

describe('the console’s OpenUI library', () => {
  it.each(VIEW_NAMES)('renders the %s answer with no parse or tool errors', async (view) => {
    const { program } = compose(intent(view, { subject: 'hotel block', sessionId: 'sess_aaaaaaaaaaaaaaaa' }), EVERYTHING, SCREENS);
    const { problems, container } = await show(program);
    expect(problems(), program).toEqual([]);
    expect(container.textContent?.length).toBeGreaterThan(20);
  });

  it('draws visits from the queried data: figures, the delta, a table and the chart’s data', async () => {
    const { calls } = await show(compose(intent('traffic'), EVERYTHING).program);
    expect(screen.getByText('41')).toBeTruthy();
    expect(screen.getByText('+37%')).toBeTruthy();
    expect(screen.getByRole('cell', { name: '/guests/travel' })).toBeTruthy();
    expect(screen.getByText('Largest paint (LCP)')).toBeTruthy();
    // The live query went through the host with a number, not the control’s text.
    expect(calls[0]).toEqual({ name: 'admin_site_traffic', body: { input: { windowHours: 168 } } });
  });

  it('changing the window asks the tool again for that window', async () => {
    const { calls } = await show(compose(intent('traffic'), EVERYTHING).program);
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: '24h' })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(calls.at(-1)).toEqual({ name: 'admin_site_traffic', body: { input: { windowHours: 24 } } });
    expect(screen.getByRole('radio', { name: '24h' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a follow-up button hands its question back to the conversation', async () => {
    const { onAsk } = await show(compose(intent('rsvp'), EVERYTHING).program);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Who has not replied?' })));
    expect(onAsk).toHaveBeenCalledWith('Who has not replied?');
  });

  it('links stay inside the console', async () => {
    await show(compose(intent('sessions'), EVERYTHING).program);
    const link = screen.getByRole('link', { name: 'Ada Testhouse' });
    expect(link.getAttribute('href')).toBe('/admin/sessions?id=sess_aaaaaaaaaaaaaaaa');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('a proposal drafts, shows what changes, and saves only when its named button is pressed', async () => {
    const seen: { name: string; body: Record<string, unknown> }[] = [];
    const call: AssistantHost['call'] = async (name, body) => {
      seen.push({ name, body: body as Record<string, unknown> });
      if (name === 'draft_lifecycle_transition') return { ok: true, data: { consequences: ['Guests can reply.'] }, confirmation: { token: 'tok', expiresAt: '', summary: 's' } };
      if (name === 'admin_publish_lifecycle') return { ok: true, data: {} };
      return name in RAW ? { ok: true, data: RAW[name] } : { ok: false };
    };
    await show(compose(intent('lifecycle', { state: 'RSVP_OPEN' }), { now: '', lifecycle: LIFECYCLE }).program, call);
    const proposal = screen.getByRole('region', { name: 'Proposed change: Publish RSVPs open' });
    expect(seen.some((c) => c.name === 'admin_publish_lifecycle')).toBe(false);

    await act(async () => fireEvent.click(within(proposal).getByRole('button', { name: 'Review' })));
    expect(seen.at(-1)).toEqual({ name: 'draft_lifecycle_transition', body: { input: { to: 'RSVP_OPEN' } } });
    expect(within(proposal).getByText('Guests can reply.')).toBeTruthy();
    expect(seen.some((c) => c.name === 'admin_publish_lifecycle')).toBe(false);

    await act(async () => fireEvent.click(within(proposal).getByRole('button', { name: 'Publish RSVPs open' })));
    const publish = seen.find((c) => c.name === 'admin_publish_lifecycle')!;
    expect(publish.body).toMatchObject({ input: { to: 'RSVP_OPEN' }, confirmationToken: 'tok' });
    expect(typeof publish.body.idempotencyKey).toBe('string');
    expect(within(proposal).getByRole('status').textContent).toContain('Done');
  });

  it('a proposal for a capability that is not on the list offers no button at all', async () => {
    const seen: string[] = [];
    await show('root = Col([p])\np = Proposal("Delete everyone", "Removes every guest.", "admin_delete_guest", {guestId: "x"}, "Delete everyone", true)', async (name) => (seen.push(name), { ok: true, data: {} }));
    const proposal = screen.getByRole('region', { name: 'Proposed change: Delete everyone' });
    expect(within(proposal).queryByRole('button')).toBeNull();
    expect(within(proposal).getByText('This change is made on its own screen, not from here.')).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it('a query for a tool that is not on the list is not sent', async () => {
    const seen: string[] = [];
    const { problems } = await show('root = Col([Text(x.name)])\nx = Query("admin_export_guests_csv", {}, {"name": "none"})', async (name) => (seen.push(name), { ok: true, data: { name: 'leaked' } }));
    expect(seen).toEqual([]);
    expect(screen.queryByText('leaked')).toBeNull();
    expect(problems().length).toBeGreaterThan(0);
  });

  it('a link that is not a console path or an http address is text, not a link', async () => {
    await show('root = Col([Link("click", "javascript:alert(1)"), Link("out", "https://example.com/a")])');
    expect(screen.queryByRole('link', { name: 'click' })).toBeNull();
    expect(screen.getByRole('link', { name: 'out' }).getAttribute('rel')).toBe('noopener noreferrer');
  });
});
